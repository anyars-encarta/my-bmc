import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import { facilitySetup } from "../../db/schema/index.js";
import { badRequest, notFound, validationError } from "../../lib/errors.js";
import { nowAtFacility } from "../../lib/facilityClock.js";
import { requireAnyRole } from "../../lib/platform.js";

const router = Router();

const FACILITY_WRITERS = ["SUPER_ADMIN", "HOSPITAL_ADMIN"] as const;

const facilityUpdateSchema = z.object({
  facilityName: z.string().min(1).max(255).optional(),
  facilityCode: z.string().min(1).max(50).optional(),
  telephone: z.string().max(20).nullable().optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  timezone: z.string().min(1).max(60).optional(),
  currency: z.string().length(3).optional(),
  locale: z.string().min(2).max(10).optional(),
  privacyPolicyVersion: z.string().max(20).nullable().optional(),
  financialYearStartMonth: z.number().int().min(1).max(12).optional(),
  nhiaFacilityCode: z.string().max(30).nullable().optional(),
  gpsDigitalAddress: z.string().max(20).nullable().optional(),
  registrationNumber: z.string().max(40).nullable().optional(),
});

const nextDocNumberSchema = z.object({
  docType: z.string().min(1).max(20),
  periodKey: z.string().min(4).max(8),
});

router.get("/", async (_req, res, next) => {
  try {
    const [record] = await db.select().from(facilitySetup).limit(1);
    if (!record) {
      throw notFound("Facility setup has not been configured yet.", "FACILITY_NOT_CONFIGURED");
    }
    const clock = await nowAtFacility();
    res.json({ data: record, meta: { clock } });
  } catch (error) {
    next(error);
  }
});

router.put("/", requireAnyRole([...FACILITY_WRITERS]), async (req, res, next) => {
  try {
    const parsed = facilityUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const changes = parsed.data;
    if (Object.keys(changes).length === 0) {
      throw badRequest("At least one field must be provided.", "EMPTY_UPDATE");
    }

    const [existing] = await db.select({ id: facilitySetup.id }).from(facilitySetup).limit(1);

    if (!existing) {
      const [created] = await db
        .insert(facilitySetup)
        .values({
          facilityName: changes.facilityName ?? "BMC Facility",
          facilityCode: changes.facilityCode ?? "BMC",
          telephone: changes.telephone ?? null,
          email: changes.email ?? null,
          address: changes.address ?? null,
          logoUrl: changes.logoUrl ?? null,
          timezone: changes.timezone ?? "UTC",
          currency: changes.currency ?? "GHS",
          locale: changes.locale ?? "en-GH",
          privacyPolicyVersion: changes.privacyPolicyVersion ?? null,
          financialYearStartMonth: changes.financialYearStartMonth ?? 1,
          nhiaFacilityCode: changes.nhiaFacilityCode ?? null,
          gpsDigitalAddress: changes.gpsDigitalAddress ?? null,
          registrationNumber: changes.registrationNumber ?? null,
        })
        .returning();

      res.json({ data: created });
      return;
    }

    const [updated] = await db
      .update(facilitySetup)
      .set({
        ...changes,
        updatedAt: new Date(),
      })
      .where(eq(facilitySetup.id, existing.id))
      .returning();

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.post("/document-number", requireAnyRole([...FACILITY_WRITERS]), async (req, res, next) => {
  try {
    const parsed = nextDocNumberSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const result = await db.execute<{ value: number }>(
      sql`SELECT next_doc_number(${parsed.data.docType}, ${parsed.data.periodKey})::bigint AS value`,
    );

    const value = Number((result.rows[0] as { value?: string | number } | undefined)?.value ?? 0);
    res.json({ data: { docType: parsed.data.docType, periodKey: parsed.data.periodKey, value } });
  } catch (error) {
    next(error);
  }
});

export default router;
