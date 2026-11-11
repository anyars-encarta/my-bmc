import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import {
  appUserRole,
  breakGlassAccess,
  notification,
  orgUnit,
  patient,
  staff,
  user,
  type BreakGlassAccess,
  type Patient,
} from "../../db/schema/index.js";
import { conflict, forbidden, notFound, validationError } from "../../lib/errors.js";
import { parseListQuery, toPageResponse } from "../../lib/listQuery.js";
import {
  findActiveBreakGlass,
  patientActor,
  resolveRestriction,
  writePatientAudit,
  type PatientRestriction,
} from "../../lib/patientAccess.js";
import { loadUserNames, parseBody, parseId, resolvePatientUnitScope } from "../../lib/patientHttp.js";
import { loadPatient } from "../../lib/patientRegistry.js";
import {
  BREAK_GLASS_OUTCOMES,
  BREAK_GLASS_REVIEW_READ_ROLES,
  BREAK_GLASS_REVIEW_WRITE_ROLES,
  getPatientConfig,
  PATIENT_READ_ROLES,
} from "../../lib/patientRules.js";
import { requireAnyRole } from "../../lib/platform.js";
import { resolveManagedUnitIds } from "../../lib/unitAccess.js";

const router = Router();
/** Review queue, mounted at `/privacy/break-glass-reviews`. */
export const breakGlassReviewRoutes = Router();

const REVIEW_DUE_MS = 2 * 24 * 60 * 60 * 1000;

const requestSchema = z.object({
  patientId: z.string().uuid(),
  reason: z.string().trim().max(500),
});

const reviewSchema = z.object({
  outcome: z.enum(BREAK_GLASS_OUTCOMES),
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => (value ? value : null)),
});

const presentGrant = (grant: BreakGlassAccess) => ({
  id: grant.id,
  patientId: grant.patientId,
  reason: grant.reason,
  grantedAt: grant.grantedAt,
  expiresAt: grant.expiresAt,
});

/** Queues the automatic notifications to the DPO and the head of the patient's registration unit. */
const notifyBreakGlass = async (
  req: Request,
  grant: BreakGlassAccess,
  target: Patient,
  restriction: PatientRestriction,
) => {
  const payload = {
    grantId: grant.id,
    actorName: req.user?.name ?? req.user?.email ?? "Unknown user",
    restriction,
    grantedAt: grant.grantedAt.toISOString(),
    expiresAt: grant.expiresAt.toISOString(),
  };
  const base = {
    template: "BREAK_GLASS_GRANTED",
    payload,
    status: "QUEUED",
    relatedEntityType: "break_glass_access",
    relatedEntityId: grant.id,
  };

  const [dpoUsers, unitHeads] = await Promise.all([
    db
      .select({ email: user.email })
      .from(appUserRole)
      .innerJoin(user, eq(user.id, appUserRole.userId))
      .where(and(eq(appUserRole.role, "dpo"), eq(user.status, "active"))),
    target.registeredUnitId
      ? db
          .select({ staffId: staff.id, email: staff.email })
          .from(orgUnit)
          .innerJoin(staff, eq(staff.id, orgUnit.headStaffId))
          .where(eq(orgUnit.id, target.registeredUnitId))
      : Promise.resolve([]),
  ]);

  const rows: Array<typeof notification.$inferInsert> = [
    ...dpoUsers.map((entry) => ({ ...base, channel: "IN_APP", recipientType: "USER", toAddress: entry.email })),
    ...unitHeads.map((entry) => ({
      ...base,
      channel: "IN_APP",
      recipientType: "STAFF",
      recipientId: entry.staffId,
      toAddress: entry.email,
    })),
  ];
  const dpoEmail = getPatientConfig().dpoEmail;
  if (dpoEmail && !dpoUsers.some((entry) => entry.email.toLowerCase() === dpoEmail.toLowerCase())) {
    rows.push({ ...base, channel: "EMAIL", recipientType: "EXTERNAL", toAddress: dpoEmail });
  }
  if (rows.length > 0) await db.insert(notification).values(rows);
};

router.post("/", requireAnyRole(PATIENT_READ_ROLES), async (req, res, next) => {
  try {
    const actor = patientActor(req);
    const payload = parseBody(requestSchema, req.body);
    const config = getPatientConfig();
    if (payload.reason.length < config.breakGlassReasonMinChars) {
      const message = `Give a reason of at least ${config.breakGlassReasonMinChars} characters.`;
      throw validationError(message, "BREAK_GLASS_REASON_TOO_SHORT", { fieldErrors: { reason: [message] } });
    }

    const [target, unitIds] = await Promise.all([loadPatient(payload.patientId), resolvePatientUnitScope(actor)]);
    const outOfScope =
      target && unitIds !== null && (!target.registeredUnitId || !unitIds.includes(target.registeredUnitId));
    if (!target || outOfScope || target.status === "MERGED") {
      throw notFound("Patient not found.", "PATIENT_NOT_FOUND");
    }

    const restriction = await resolveRestriction(target, actor.userId);
    if (!restriction) {
      throw conflict("This record is not restricted; break-glass is not needed.", "BREAK_GLASS_NOT_REQUIRED");
    }

    const existing = await findActiveBreakGlass(actor.userId, target.id);
    if (existing) {
      res.json({ data: presentGrant(existing) });
      return;
    }

    const [grant] = await db
      .insert(breakGlassAccess)
      .values({
        userId: actor.userId,
        patientId: target.id,
        reason: payload.reason,
        expiresAt: new Date(Date.now() + config.breakGlassHours * 60 * 60 * 1000),
      })
      .returning();
    if (!grant) throw conflict("Break-glass access could not be granted.", "BREAK_GLASS_NOT_GRANTED");

    await writePatientAudit(req, {
      action: "BREAK_GLASS",
      entityType: "break_glass_access",
      entityId: grant.id,
      patientId: target.id,
      reason: payload.reason,
      after: { restriction, expiresAt: grant.expiresAt.toISOString() },
      orgUnitId: target.registeredUnitId,
    });
    try {
      await notifyBreakGlass(req, grant, target, restriction);
    } catch (error) {
      console.error("Failed to queue break-glass notifications", { requestId: req.requestId, error });
    }

    res.status(201).json({ data: presentGrant(grant) });
  } catch (error) {
    next(error);
  }
});

const GLOBAL_REVIEW_ROLES = ["super_admin", "dpo", "auditor"];

/**
 * Units whose break-glass grants the caller may review: `null` for the DPO, auditors and
 * super admins (everything), otherwise the unit manager's own unit subtree.
 */
const reviewUnitScope = async (req: Request) => {
  const roles = req.user?.roles ?? [];
  if (!req.user?.id) throw forbidden("An authenticated user is required.");
  if (roles.some((role) => GLOBAL_REVIEW_ROLES.includes(role))) return null;
  return (await resolveManagedUnitIds(req.user.id, ["unit_manager"])) ?? [];
};

breakGlassReviewRoutes.get("/", requireAnyRole(BREAK_GLASS_REVIEW_READ_ROLES), async (req, res, next) => {
  try {
    const unitIds = await reviewUnitScope(req);
    const query = parseListQuery(req, {
      sortable: ["grantedAt"],
      filterable: ["status"],
      defaultSort: "-grantedAt",
      maxLimit: 100,
    });
    const statusFilter = query.filters.find((filter) => filter.field === "status" && filter.operator === "eq");
    const status = typeof statusFilter?.value === "string" ? statusFilter.value.toUpperCase() : "PENDING";
    const where = and(
      status === "REVIEWED"
        ? isNotNull(breakGlassAccess.reviewedAt)
        : status === "ALL"
          ? undefined
          : isNull(breakGlassAccess.reviewedAt),
      unitIds === null
        ? undefined
        : unitIds.length > 0
          ? inArray(patient.registeredUnitId, unitIds)
          : sql`false`,
    );

    const [rows, totals] = await Promise.all([
      db
        .select({
          grant: breakGlassAccess,
          userName: user.name,
          userEmail: user.email,
          patientMrn: patient.mrn,
          patientFirstName: patient.firstName,
          patientLastName: patient.lastName,
          confidentiality: patient.confidentiality,
        })
        .from(breakGlassAccess)
        .leftJoin(user, eq(user.id, breakGlassAccess.userId))
        .leftJoin(patient, eq(patient.id, breakGlassAccess.patientId))
        .where(where)
        .orderBy(desc(breakGlassAccess.grantedAt))
        .limit(query.limit)
        .offset(query.offset),
      db
        .select({ total: count() })
        .from(breakGlassAccess)
        .leftJoin(patient, eq(patient.id, breakGlassAccess.patientId))
        .where(where),
    ]);

    const reviewers = await loadUserNames(rows.map((row) => row.grant.reviewedBy));
    const now = Date.now();
    const data = rows.map((row) => ({
      id: row.grant.id,
      userName: row.userName ?? "Unknown user",
      userEmail: row.userEmail,
      patientName: row.patientFirstName ? `${row.patientFirstName} ${row.patientLastName}` : "Unknown patient",
      patientMrn: row.patientMrn,
      confidentiality: row.confidentiality,
      reason: row.grant.reason,
      grantedAt: row.grant.grantedAt,
      expiresAt: row.grant.expiresAt,
      active: row.grant.expiresAt.getTime() > now,
      reviewOverdue: !row.grant.reviewedAt && now - row.grant.grantedAt.getTime() > REVIEW_DUE_MS,
      reviewedAt: row.grant.reviewedAt,
      reviewedByName: row.grant.reviewedBy ? (reviewers.get(row.grant.reviewedBy) ?? null) : null,
      reviewOutcome: row.grant.reviewOutcome,
      reviewNote: row.grant.reviewNote,
    }));
    res.json(toPageResponse(data, query, Number(totals[0]?.total ?? 0)));
  } catch (error) {
    next(error);
  }
});

breakGlassReviewRoutes.post("/:id/review", requireAnyRole(BREAK_GLASS_REVIEW_WRITE_ROLES), async (req, res, next) => {
  try {
    const reviewerId = req.user?.id;
    if (!reviewerId) throw forbidden("An authenticated user is required.");
    const id = parseId(req.params.id);
    const payload = parseBody(reviewSchema, req.body);
    if (payload.outcome !== "JUSTIFIED" && (payload.note?.length ?? 0) < 10) {
      const message = "Explain an unjustified or escalated access in at least 10 characters.";
      throw validationError(message, "BREAK_GLASS_REVIEW_NOTE_REQUIRED", { fieldErrors: { note: [message] } });
    }

    const [unitIds, [grant]] = await Promise.all([
      reviewUnitScope(req),
      db.select().from(breakGlassAccess).where(eq(breakGlassAccess.id, id)).limit(1),
    ]);
    const target = grant && unitIds !== null ? await loadPatient(grant.patientId) : null;
    const outOfScope =
      unitIds !== null && (!target?.registeredUnitId || !unitIds.includes(target.registeredUnitId));
    if (!grant || outOfScope) throw notFound("Break-glass access not found.", "BREAK_GLASS_NOT_FOUND");
    if (grant.userId === reviewerId) {
      throw forbidden("You cannot review your own break-glass access.", "BREAK_GLASS_SELF_REVIEW");
    }

    const [updated] = await db
      .update(breakGlassAccess)
      .set({
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewOutcome: payload.outcome,
        reviewNote: payload.note,
      })
      .where(and(eq(breakGlassAccess.id, id), isNull(breakGlassAccess.reviewedAt)))
      .returning();
    if (!updated) {
      throw conflict("This access has already been reviewed.", "BREAK_GLASS_ALREADY_REVIEWED");
    }

    await writePatientAudit(req, {
      action:
        payload.outcome === "JUSTIFIED" ? "APPROVE" : payload.outcome === "UNJUSTIFIED" ? "REJECT" : "STATUS_CHANGE",
      entityType: "break_glass_access",
      entityId: updated.id,
      patientId: updated.patientId,
      reason: payload.note,
      after: { reviewOutcome: updated.reviewOutcome },
    });
    res.json({
      data: { id: updated.id, reviewOutcome: updated.reviewOutcome, reviewedAt: updated.reviewedAt },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
