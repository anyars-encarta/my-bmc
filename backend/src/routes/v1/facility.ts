import { Router } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import { facilitySetup } from "../../db/schema/index.js";
import { badRequest, notFound, validationError } from "../../lib/errors.js";
import { nowAtFacility } from "../../lib/facilityClock.js";
import { requireAnyRole } from "../../lib/platform.js";

const router = Router();

const FACILITY_WRITERS = ["SUPER_ADMIN", "HOSPITAL_ADMIN"] as const;
const isValidIanaTimezone = (timezone: string) => {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const facilityUpdateSchema = z.object({
  facilityName: z.string().min(1).max(255).optional(),
  facilityCode: z.string().min(1).max(50).optional(),
  telephone: z.string().max(20).nullable().optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  timezone: z
    .string()
    .min(1)
    .max(60)
    .refine((value) => isValidIanaTimezone(value), { message: "Invalid IANA timezone identifier." })
    .optional(),
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

    const defaults = {
      facilityName: "BMC Facility",
      facilityCode: "BMC",
      telephone: null,
      email: null,
      address: null,
      logoUrl: null,
      timezone: "UTC",
      currency: "GHS",
      locale: "en-GH",
      privacyPolicyVersion: null,
      financialYearStartMonth: 1,
      nhiaFacilityCode: null,
      gpsDigitalAddress: null,
      registrationNumber: null,
    };

    const result = await db.execute<typeof facilitySetup.$inferSelect>(
      sql`
        INSERT INTO facility_setup (
          facility_name,
          facility_code,
          telephone,
          email,
          address,
          logo_url,
          timezone,
          currency,
          locale,
          privacy_policy_version,
          financial_year_start_month,
          nhia_facility_code,
          gps_digital_address,
          registration_number
        )
        VALUES (
          ${changes.facilityName ?? defaults.facilityName},
          ${changes.facilityCode ?? defaults.facilityCode},
          ${changes.telephone ?? defaults.telephone},
          ${changes.email ?? defaults.email},
          ${changes.address ?? defaults.address},
          ${changes.logoUrl ?? defaults.logoUrl},
          ${changes.timezone ?? defaults.timezone},
          ${changes.currency ?? defaults.currency},
          ${changes.locale ?? defaults.locale},
          ${changes.privacyPolicyVersion ?? defaults.privacyPolicyVersion},
          ${changes.financialYearStartMonth ?? defaults.financialYearStartMonth},
          ${changes.nhiaFacilityCode ?? defaults.nhiaFacilityCode},
          ${changes.gpsDigitalAddress ?? defaults.gpsDigitalAddress},
          ${changes.registrationNumber ?? defaults.registrationNumber}
        )
        ON CONFLICT ((true)) DO UPDATE
        SET
          facility_name = COALESCE(EXCLUDED.facility_name, facility_setup.facility_name),
          facility_code = COALESCE(EXCLUDED.facility_code, facility_setup.facility_code),
          telephone = EXCLUDED.telephone,
          email = EXCLUDED.email,
          address = EXCLUDED.address,
          logo_url = EXCLUDED.logo_url,
          timezone = COALESCE(EXCLUDED.timezone, facility_setup.timezone),
          currency = COALESCE(EXCLUDED.currency, facility_setup.currency),
          locale = COALESCE(EXCLUDED.locale, facility_setup.locale),
          privacy_policy_version = EXCLUDED.privacy_policy_version,
          financial_year_start_month = COALESCE(EXCLUDED.financial_year_start_month, facility_setup.financial_year_start_month),
          nhia_facility_code = EXCLUDED.nhia_facility_code,
          gps_digital_address = EXCLUDED.gps_digital_address,
          registration_number = EXCLUDED.registration_number,
          updated_at = now()
        RETURNING *
      `,
    );

    const updated = result.rows[0];
    if (!updated) {
      throw badRequest("Unable to update facility setup.", "FACILITY_UPDATE_FAILED");
    }

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
