import { and, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import { consent } from "../../db/schema/index.js";
import { badRequest, validationError } from "../../lib/errors.js";

const router = Router();

const consentCreateSchema = z.object({
  subjectType: z.enum(["PATIENT", "STAFF"]),
  subjectId: z.string().uuid(),
  consentType: z.string().min(1).max(30),
  status: z.enum(["GRANTED", "WITHDRAWN", "DECLINED"]),
  policyVersion: z.string().min(1).max(20),
  captureMethod: z.enum(["PAPER", "ELECTRONIC", "VERBAL_WITNESSED"]),
  witnessStaffId: z.string().uuid().nullable().optional(),
  guardianName: z.string().max(150).nullable().optional(),
  guardianRelationship: z.string().max(40).nullable().optional(),
  evidenceAttachmentId: z.string().uuid().nullable().optional(),
  note: z.string().nullable().optional(),
});

router.get("/latest", async (req, res, next) => {
  try {
    const subjectType = req.query.subjectType;
    const subjectId = req.query.subjectId;
    const consentType = req.query.consentType;

    if (
      (subjectType !== "PATIENT" && subjectType !== "STAFF") ||
      typeof subjectId !== "string" ||
      typeof consentType !== "string"
    ) {
      throw badRequest(
        "subjectType, subjectId, and consentType are required.",
        "CONSENT_QUERY_INVALID",
      );
    }

    const [latest] = await db
      .select()
      .from(consent)
      .where(
        and(
          eq(consent.subjectType, subjectType),
          eq(consent.subjectId, subjectId),
          eq(consent.consentType, consentType),
        ),
      )
      .orderBy(desc(consent.createdAt))
      .limit(1);

    res.json({ data: latest ?? null });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = consentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const record = parsed.data;
    const [created] = await db
      .insert(consent)
      .values({
        subjectType: record.subjectType,
        subjectId: record.subjectId,
        consentType: record.consentType,
        status: record.status,
        policyVersion: record.policyVersion,
        captureMethod: record.captureMethod,
        grantedAt: record.status === "GRANTED" ? new Date() : null,
        withdrawnAt: record.status === "WITHDRAWN" ? new Date() : null,
        capturedBy: req.user?.id ?? "system",
        witnessStaffId: record.witnessStaffId ?? null,
        guardianName: record.guardianName ?? null,
        guardianRelationship: record.guardianRelationship ?? null,
        evidenceAttachmentId: record.evidenceAttachmentId ?? null,
        note: record.note ?? null,
      })
      .returning();

    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

export default router;
