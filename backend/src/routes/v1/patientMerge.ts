import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Router, type Request } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import { patient, patientDuplicateCandidate, patientMergeLog, patientMergeTask } from "../../db/schema/index.js";
import { ApiError, conflict, notFound, validationError } from "../../lib/errors.js";
import { parseListQuery, toPageResponse } from "../../lib/listQuery.js";
import { assertChartAccess, patientActor, type PatientActor, writePatientAudit } from "../../lib/patientAccess.js";
import {
  loadUserNames,
  parseBody,
  parseId,
  presentPatientSummaries,
  resolvePatientUnitScope,
  serializeContextFor,
} from "../../lib/patientHttp.js";
import {
  facilityToday,
  loadPatient,
  MERGEABLE_FIELDS,
  mergePatients,
  processMergeTasks,
  runMergePrechecks,
  summarizeMergeStatus,
  sweepDuplicateCandidates,
  type MergeableField,
} from "../../lib/patientRegistry.js";
import {
  maskPatientSummary,
  PATIENT_MERGE_ROLES,
  serializePatientDetail,
  serializePatientSummary,
} from "../../lib/patientRules.js";
import { requireAnyRole } from "../../lib/platform.js";

const router = Router();
export const mergeTaskRoutes = Router();

const MERGEABLE_FIELD_NAMES = Object.keys(MERGEABLE_FIELDS) as [MergeableField, ...MergeableField[]];

const mergeSchema = z.object({
  survivorId: z.string().uuid(),
  mergedId: z.string().uuid(),
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500),
  takeFromMerged: z.array(z.enum(MERGEABLE_FIELD_NAMES)).max(MERGEABLE_FIELD_NAMES.length).default([]),
});

const sweepSchema = z.object({ sinceDays: z.number().int().min(1).max(90).default(1) });

const presentTask = (task: typeof patientMergeTask.$inferSelect) => ({
  id: task.id,
  module: task.module,
  status: task.status,
  rowsMoved: task.rowsMoved,
  note: task.lastError,
  attempts: task.attempts,
  completedAt: task.completedAt,
});

const loadMergePair = async (survivorId: string, mergedId: string) => {
  if (survivorId === mergedId) {
    throw validationError("Choose two different patient records.", "PATIENT_MERGE_SAME_RECORD");
  }
  const [survivor, merged] = await Promise.all([loadPatient(survivorId), loadPatient(mergedId)]);
  if (!survivor || !merged) throw notFound("Patient not found.", "PATIENT_NOT_FOUND");
  return { survivor, merged };
};

/* ------------------------------------------------------------------ */
/* Duplicate review queue                                              */
/* ------------------------------------------------------------------ */

router.get("/duplicates", requireAnyRole(PATIENT_MERGE_ROLES), async (req, res, next) => {
  try {
    const actor = patientActor(req);
    const query = parseListQuery(req, {
      sortable: ["score", "detectedAt"],
      filterable: ["status"],
      defaultSort: "-score",
      maxLimit: 100,
    });
    const statusFilter = query.filters.find((filter) => filter.field === "status" && filter.operator === "eq");
    const status = typeof statusFilter?.value === "string" ? statusFilter.value : "PENDING";

    const patientA = alias(patient, "patient_a");
    const patientB = alias(patient, "patient_b");
    const where = eq(patientDuplicateCandidate.status, status);
    const [rows, totals, { todayIso }] = await Promise.all([
      db
        .select({ candidate: patientDuplicateCandidate, patientA, patientB })
        .from(patientDuplicateCandidate)
        .innerJoin(patientA, eq(patientA.id, patientDuplicateCandidate.patientAId))
        .innerJoin(patientB, eq(patientB.id, patientDuplicateCandidate.patientBId))
        .where(where)
        .orderBy(
          query.sort[0]?.field === "detectedAt"
            ? desc(patientDuplicateCandidate.detectedAt)
            : desc(patientDuplicateCandidate.score),
          desc(patientDuplicateCandidate.detectedAt),
        )
        .limit(query.limit)
        .offset(query.offset),
      db
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(patientDuplicateCandidate)
        .where(where),
      facilityToday(),
    ]);

    const summaries = await presentPatientSummaries(
      rows.flatMap((row) => [row.patientA, row.patientB]),
      actor,
      todayIso,
    );
    const reviewers = await loadUserNames(rows.map((row) => row.candidate.reviewedBy));
    const data = rows.map((row, index) => ({
      id: row.candidate.id,
      score: Number(row.candidate.score),
      reasons: row.candidate.reasons,
      status: row.candidate.status,
      source: row.candidate.source,
      detectedAt: row.candidate.detectedAt,
      reviewedAt: row.candidate.reviewedAt,
      reviewedByName: row.candidate.reviewedBy ? (reviewers.get(row.candidate.reviewedBy) ?? null) : null,
      patientA: summaries[index * 2],
      patientB: summaries[index * 2 + 1],
    }));
    res.json(toPageResponse(data, query, totals[0]?.total ?? 0));
  } catch (error) {
    next(error);
  }
});

router.post("/duplicates/sweep", requireAnyRole(PATIENT_MERGE_ROLES), async (req, res, next) => {
  try {
    patientActor(req);
    const payload = parseBody(sweepSchema, req.body);
    const result = await sweepDuplicateCandidates({ sinceHours: payload.sinceDays * 24, limit: 200 });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/duplicates/:candidateId/dismiss", requireAnyRole(PATIENT_MERGE_ROLES), async (req, res, next) => {
  try {
    const actor = patientActor(req);
    const candidateId = parseId(req.params.candidateId, "candidateId");
    const [candidate] = await db
      .select()
      .from(patientDuplicateCandidate)
      .where(and(eq(patientDuplicateCandidate.id, candidateId), eq(patientDuplicateCandidate.status, "PENDING")))
      .limit(1);
    if (!candidate) {
      throw conflict("This pair has already been reviewed.", "PATIENT_DUPLICATE_ALREADY_REVIEWED");
    }

    const [patientA, patientB, unitIds] = await Promise.all([
      loadPatient(candidate.patientAId),
      loadPatient(candidate.patientBId),
      resolvePatientUnitScope(actor),
    ]);
    const isOutOfScope = (record: Awaited<ReturnType<typeof loadPatient>>) =>
      record && unitIds !== null && (!record.registeredUnitId || !unitIds.includes(record.registeredUnitId));
    if (!patientA || !patientB || isOutOfScope(patientA) || isOutOfScope(patientB)) {
      throw notFound("Patient not found.", "PATIENT_NOT_FOUND");
    }
    await assertChartAccess(req, actor, patientA, "patient_duplicate_candidate");
    await assertChartAccess(req, actor, patientB, "patient_duplicate_candidate");

    const [updated] = await db
      .update(patientDuplicateCandidate)
      .set({ status: "DISMISSED", reviewedBy: actor.userId, reviewedAt: new Date() })
      .where(and(eq(patientDuplicateCandidate.id, candidateId), eq(patientDuplicateCandidate.status, "PENDING")))
      .returning();
    if (!updated) {
      throw conflict("This pair has already been reviewed.", "PATIENT_DUPLICATE_ALREADY_REVIEWED");
    }
    await writePatientAudit(req, {
      action: "REJECT",
      entityType: "patient_duplicate_candidate",
      entityId: updated.id,
      patientId: updated.patientAId,
      reason: "Records confirmed as different patients",
      after: { otherPatientId: updated.patientBId, score: Number(updated.score) },
    });
    res.json({ data: { id: updated.id, status: updated.status } });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ */
/* Merge                                                               */
/* ------------------------------------------------------------------ */

router.get("/merge/preview", requireAnyRole(PATIENT_MERGE_ROLES), async (req, res, next) => {
  try {
    const actor = patientActor(req);
    const { survivor, merged } = await loadMergePair(
      parseId(req.query.survivorId, "survivorId"),
      parseId(req.query.mergedId, "mergedId"),
    );
    await assertChartAccess(req, actor, survivor, "patient_merge");
    await assertChartAccess(req, actor, merged, "patient_merge");

    const [{ todayIso }, prechecks] = await Promise.all([facilityToday(), runMergePrechecks(survivor, merged)]);
    const context = serializeContextFor(actor, todayIso);
    res.json({
      data: {
        survivor: serializePatientDetail(survivor, context),
        merged: serializePatientDetail(merged, context),
        prechecks,
        canMerge: prechecks.every((check) => check.passed),
        mergeableFields: MERGEABLE_FIELD_NAMES,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/merge", requireAnyRole(PATIENT_MERGE_ROLES), async (req, res, next) => {
  try {
    const actor = patientActor(req);
    const payload = parseBody(mergeSchema, req.body);
    const { survivor, merged } = await loadMergePair(payload.survivorId, payload.mergedId);
    await assertChartAccess(req, actor, survivor, "patient_merge");
    await assertChartAccess(req, actor, merged, "patient_merge");

    const result = await mergePatients({
      survivor,
      merged,
      reason: payload.reason,
      takeFromMerged: payload.takeFromMerged,
      userId: actor.userId,
    });
    await writePatientAudit(req, {
      action: "UPDATE",
      entityType: "patient_merge",
      entityId: result.mergeLogId,
      patientId: survivor.id,
      reason: payload.reason,
      after: { mergedPatientId: merged.id, takeFromMerged: payload.takeFromMerged, status: result.status },
    });

    res.status(201).json({
      data: {
        mergeLogId: result.mergeLogId,
        survivorId: survivor.id,
        status: result.status,
        tasks: result.tasks.map(presentTask),
      },
    });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ */
/* Merge task tracking (/merge-tasks)                                  */
/* ------------------------------------------------------------------ */

/** Loads merge history with both patient labels masked when chart or unit access is unavailable. */
const loadMergeSummaries = async (
  req: Request,
  actor: PatientActor,
  logs: Array<typeof patientMergeLog.$inferSelect>,
) => {
  if (logs.length === 0) return [];
  const patientIds = [...new Set(logs.flatMap((log) => [log.survivorId, log.mergedId]))];
  const [tasks, patients, names, unitIds, { todayIso }] = await Promise.all([
    db
      .select()
      .from(patientMergeTask)
      .where(inArray(patientMergeTask.mergeLogId, logs.map((log) => log.id))),
    db.select().from(patient).where(inArray(patient.id, patientIds)),
    loadUserNames(logs.map((log) => log.mergedBy)),
    resolvePatientUnitScope(actor),
    facilityToday(),
  ]);
  const summariesById = new Map<string, { mrn: string | null; fullName: string; masked: boolean }>();
  await Promise.all(
    patients.map(async (row) => {
      if (unitIds !== null && (!row.registeredUnitId || !unitIds.includes(row.registeredUnitId))) {
        const summary = maskPatientSummary(row);
        summariesById.set(row.id, { mrn: summary.mrn, fullName: summary.fullName, masked: true });
        return;
      }
      try {
        await assertChartAccess(req, actor, row, "patient_merge");
        const summary = serializePatientSummary(row, serializeContextFor(actor, todayIso));
        summariesById.set(row.id, { mrn: summary.mrn, fullName: summary.fullName, masked: false });
      } catch (error) {
        if (error instanceof ApiError && error.code === "BREAK_GLASS_REQUIRED") {
          const summary = maskPatientSummary(row);
          summariesById.set(row.id, { mrn: summary.mrn, fullName: summary.fullName, masked: true });
          return;
        }
        throw error;
      }
    }),
  );
  const label = (id: string) => {
    const summary = summariesById.get(id);
    return summary
      ? { mrn: summary.masked ? null : summary.mrn, name: summary.masked ? "Restricted record" : summary.fullName }
      : null;
  };

  return logs.map((log) => {
    const ownTasks = tasks
      .filter((task) => task.mergeLogId === log.id)
      .sort((left, right) => left.module.localeCompare(right.module));
    const survivor = summariesById.get(log.survivorId);
    const merged = summariesById.get(log.mergedId);
    const detailsRestricted = !survivor || survivor.masked || !merged || merged.masked;
    return {
      id: log.id,
      mergedAt: log.mergedAt,
      mergedByName: names.get(log.mergedBy) ?? null,
      reason: detailsRestricted ? "Restricted merge details" : log.reason,
      survivorId: log.survivorId,
      survivor: label(log.survivorId),
      merged: label(log.mergedId),
      status: summarizeMergeStatus(ownTasks),
      tasks: ownTasks.map((task) => (detailsRestricted ? { ...presentTask(task), note: null } : presentTask(task))),
    };
  });
};

mergeTaskRoutes.get("/", requireAnyRole(PATIENT_MERGE_ROLES), async (req, res, next) => {
  try {
    const actor = patientActor(req);
    const query = parseListQuery(req, { sortable: ["mergedAt"], filterable: [], defaultSort: "-mergedAt", maxLimit: 50 });
    const [logs, totals] = await Promise.all([
      db
        .select()
        .from(patientMergeLog)
        .orderBy(desc(patientMergeLog.mergedAt))
        .limit(query.limit)
        .offset(query.offset),
      db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(patientMergeLog),
    ]);
    res.json(toPageResponse(await loadMergeSummaries(req, actor, logs), query, totals[0]?.total ?? 0));
  } catch (error) {
    next(error);
  }
});

mergeTaskRoutes.get("/:id", requireAnyRole(PATIENT_MERGE_ROLES), async (req, res, next) => {
  try {
    const actor = patientActor(req);
    const id = parseId(req.params.id);
    const logs = await db.select().from(patientMergeLog).where(eq(patientMergeLog.id, id)).limit(1);
    const [summary] = await loadMergeSummaries(req, actor, logs);
    if (!summary) throw notFound("Merge not found.", "PATIENT_MERGE_NOT_FOUND");
    res.json({ data: summary });
  } catch (error) {
    next(error);
  }
});

mergeTaskRoutes.post("/:id/retry", requireAnyRole(PATIENT_MERGE_ROLES), async (req, res, next) => {
  try {
    const actor = patientActor(req);
    const id = parseId(req.params.id);
    const logs = await db.select().from(patientMergeLog).where(eq(patientMergeLog.id, id)).limit(1);
    const log = logs[0];
    if (!log) throw notFound("Merge not found.", "PATIENT_MERGE_NOT_FOUND");

    // Re-pointing is idempotent, so tasks parked for manual review can safely be run again.
    await db
      .update(patientMergeTask)
      .set({ status: "PENDING" })
      .where(and(eq(patientMergeTask.mergeLogId, id), eq(patientMergeTask.status, "MANUAL_REVIEW")));
    await processMergeTasks(id);
    await writePatientAudit(req, {
      action: "UPDATE",
      entityType: "patient_merge",
      entityId: id,
      patientId: log.survivorId,
      reason: "Merge re-pointing retried",
    });

    const [summary] = await loadMergeSummaries(req, actor, logs);
    res.json({ data: summary });
  } catch (error) {
    next(error);
  }
});

export default router;
