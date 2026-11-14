import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import {
  appointment,
  appointmentRebookTask,
  appointmentSlot,
  clinicSessionTemplate,
  orgUnit,
  patient,
  patientIdentifier,
  priceList,
  priceListItem,
  queueTicket,
  serviceItem,
  staff,
  visit,
  type Appointment,
} from "../../db/schema/index.js";
import { conflict, forbidden, notFound, validationError } from "../../lib/errors.js";
import { resolveManagedUnitIds } from "../../lib/unitAccess.js";
import { isAppRole } from "../../lib/appRoles.js";
import { requireAnyRole } from "../../lib/platform.js";
import { assertChartAccess, findActiveBreakGlassPatientIds, patientActor } from "../../lib/patientAccess.js";
import { resolvePatientUnitScope } from "../../lib/patientHttp.js";

const router = Router();
const DAY_MS = 24 * 60 * 60_000;

const APPOINTMENT_READ_ROLES = [
  "super_admin", "hospital_admin", "unit_manager", "roster_officer", "registrar",
  "records_officer", "cashier", "billing_officer", "doctor", "nurse", "midwife",
];
const APPOINTMENT_WRITE_ROLES = [
  "super_admin", "hospital_admin", "unit_manager", "registrar", "records_officer",
  "cashier", "billing_officer", "doctor", "nurse", "midwife",
];
const CHARGE_READ_ROLES = [
  "super_admin", "hospital_admin", "cashier", "billing_officer", "accounts",
  "doctor", "nurse", "midwife", "pharmacist", "lab_scientist", "radiographer",
];
const CHARGE_WRITE_ROLES = ["super_admin", "hospital_admin", "cashier", "billing_officer"];
const SESSION_WRITE_ROLES = ["super_admin", "hospital_admin", "unit_manager"];

const serviceCategories = [
  "REGISTRATION", "CONSULTATION", "PROCEDURE", "LAB", "IMAGING", "DRUG",
  "CONSUMABLE", "BED_DAY", "NURSING", "OTHER",
] as const;
const payerTypes = ["CASH", "NHIS", "PRIVATE", "CORPORATE", "STAFF", "EXEMPT"] as const;
const appointmentTypes = ["NEW", "FOLLOW_UP", "REVIEW", "PROCEDURE", "WALK_IN"] as const;
const bookedViaTypes = ["FRONT_DESK", "PHONE", "ONLINE", "REFERRAL", "CLINIC"] as const;
const appointmentStatuses = ["BOOKED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW", "CANCELLED", "RESCHEDULED"] as const;
const queueStages = ["CASHIER", "TRIAGE", "CONSULTATION", "LAB", "IMAGING", "PHARMACY"] as const;
const uuid = z.string().uuid();
const dateOnly = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Use a real calendar date.");
const optionalText = (limit: number) => z.string().trim().max(limit).nullish().transform((value) => value || null);
const parseBody = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw validationError("Some fields are invalid.", "VALIDATION_ERROR", parsed.error.flatten());
  }
  return parsed.data;
};
const requestId = (req: Request, key: string) => {
  const value = req.params[key];
  if (typeof value !== "string" || !z.string().uuid().safeParse(value).success) {
    throw validationError("A valid record reference is required.", "INVALID_ID");
  }
  return value;
};
const roleList = (req: Request) => (req.user?.roles ?? []).filter(isAppRole);
const hasSqlStateCause = (error: unknown, code: string) => {
  if (typeof error !== "object" || error === null || !("cause" in error)) return false;
  const cause = error.cause;
  return typeof cause === "object" && cause !== null && "code" in cause &&
    String((cause as { code: unknown }).code) === code;
};

const scopedUnitIds = async (req: Request) => {
  const roles = roleList(req);
  if (!req.user?.id || !roles.some((role) => role === "unit_manager" || role === "roster_officer")) return null;
  return resolveManagedUnitIds(req.user.id, roles);
};

const checkUnitAccess = async (req: Request, unitId: string) => {
  const roles = roleList(req);
  if (!req.user?.id || !roles.some((role) => role === "unit_manager" || role === "roster_officer")) return;
  const managed = await resolveManagedUnitIds(req.user.id, roles);
  if (managed !== null && !managed.includes(unitId)) {
    throw forbidden("You do not have access to this clinic.", "UNIT_SCOPE_FORBIDDEN");
  }
};

const ensureAppointmentAccess = async (req: Request, appointmentId: string) => {
  const [record] = await db.select({
    unitId: appointment.orgUnitId,
    patientId: patient.id,
    confidentiality: patient.confidentiality,
  }).from(appointment)
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .where(eq(appointment.id, appointmentId))
    .limit(1);
  if (!record) throw notFound("Appointment not found.", "APPOINTMENT_NOT_FOUND");
  await checkUnitAccess(req, record.unitId);
  await assertChartAccess(req, patientActor(req), {
    id: record.patientId,
    confidentiality: record.confidentiality,
  }, "appointment");
  return record;
};

const ensureVisitAccess = async (req: Request, visitId: string) => {
  const [record] = await db.select({
    unitId: visit.currentUnitId,
    patientId: patient.id,
    confidentiality: patient.confidentiality,
  }).from(visit)
    .innerJoin(patient, eq(patient.id, visit.patientId))
    .where(eq(visit.id, visitId))
    .limit(1);
  if (!record) throw notFound("Visit not found.", "VISIT_NOT_FOUND");
  if (record.unitId) await checkUnitAccess(req, record.unitId);
  await assertChartAccess(req, patientActor(req), {
    id: record.patientId,
    confidentiality: record.confidentiality,
  }, "visit");
};

const assertClinicUnit = async (unitId: string) => {
  const [unit] = await db.select({ id: orgUnit.id })
    .from(orgUnit)
    .where(and(eq(orgUnit.id, unitId), eq(orgUnit.isClinical, true), eq(orgUnit.active, true)))
    .limit(1);
  if (!unit) throw validationError("Choose an active clinical unit.", "CLINIC_UNIT_INVALID");
};

const assertClinicalProvider = async (providerId: string | null) => {
  if (!providerId) return;
  const [provider] = await db.select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.id, providerId), eq(staff.status, "active"), eq(staff.staffCategory, "CLINICAL")))
    .limit(1);
  if (!provider) throw validationError("Choose an active clinical provider.", "CLINIC_PROVIDER_INVALID");
};

const maskedPatientIds = async (
  req: Request,
  rows: Array<{ patientId: string; confidentiality: string; registeredUnitId: string | null }>,
) => {
  if (rows.length === 0) return new Set<string>();
  const actor = patientActor(req);
  const patientIds = Array.from(new Set(rows.map((row) => row.patientId)));
  const [grants, ownRows, unitScope] = await Promise.all([
    findActiveBreakGlassPatientIds(actor.userId, patientIds),
    db.select({ patientId: patientIdentifier.patientId })
      .from(patientIdentifier)
      .innerJoin(staff, sql`upper(${staff.employeeId}) = upper(${patientIdentifier.idValue})`)
      .where(and(
        inArray(patientIdentifier.patientId, patientIds),
        eq(patientIdentifier.idType, "STAFF_ID"),
        eq(patientIdentifier.status, "ACTIVE"),
        eq(staff.userId, actor.userId),
      )),
    resolvePatientUnitScope(actor),
  ]);
  const ownIds = new Set(ownRows.map((row) => row.patientId));
  return new Set(rows.filter((row) => {
    const isRestricted = row.confidentiality !== "NORMAL" || ownIds.has(row.patientId);
    const isOutOfScope = unitScope !== null && (!row.registeredUnitId || !unitScope.includes(row.registeredUnitId));
    return isOutOfScope || (isRestricted && !grants.has(row.patientId));
  }).map((row) => row.patientId));
};

const currentDate = () => new Date().toISOString().slice(0, 10);
const safePage = (value: unknown, fallback: number, ceiling: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, ceiling) : fallback;
};

const serviceItemSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(200),
  category: z.enum(serviceCategories),
  defaultOrgUnitId: uuid.nullish().transform((value) => value ?? null),
  nhisTariffCode: optionalText(30),
  gdrgCode: optionalText(15),
  isBillable: z.boolean().default(true),
  allowDiscount: z.boolean().default(true),
  active: z.boolean().default(true),
});
const priceItemPatchSchema = z.object({
  serviceItemId: uuid.optional(),
  price: z.coerce.number().finite().min(0).max(999999999999.99).optional(),
  effectiveFrom: dateOnly.optional(),
  effectiveTo: dateOnly.nullish(),
});
const serviceItemPatchSchema = serviceItemSchema.partial();
const priceListSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  payerType: z.enum(payerTypes),
  payerId: uuid.nullish().transform((value) => value ?? null),
  currency: z.string().trim().length(3).default("GHS"),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});
const priceListPatchSchema = priceListSchema.partial();
const priceItemSchema = z.object({
  serviceItemId: uuid,
  price: z.coerce.number().finite().min(0).max(999999999999.99),
  effectiveFrom: dateOnly,
  effectiveTo: dateOnly.nullish().transform((value) => value ?? null),
}).refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
  message: "The end date must be on or after the start date.",
  path: ["effectiveTo"],
});
const templateBaseSchema = z.object({
  orgUnitId: uuid,
  providerStaffId: uuid.nullish().transform((value) => value ?? null),
  weekday: z.coerce.number().int().min(1).max(7),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  slotMinutes: z.coerce.number().int().min(5).max(120),
  capacityPerSlot: z.coerce.number().int().min(1).max(100).default(1),
  overbookLimit: z.coerce.number().int().min(0).max(20).default(0),
  consultationServiceId: uuid.nullish().transform((value) => value ?? null),
  validFrom: dateOnly,
  validTo: dateOnly.nullish().transform((value) => value ?? null),
  active: z.boolean().default(true),
});
const templateSchema = templateBaseSchema.refine((value) => value.endTime > value.startTime, {
  message: "The clinic session must end after it starts.",
  path: ["endTime"],
}).refine((value) => !value.validTo || value.validTo >= value.validFrom, {
  message: "The end date must be on or after the start date.",
  path: ["validTo"],
});
const templatePatchSchema = templateBaseSchema.partial();
const bookSchema = z.object({
  patientId: uuid,
  slotId: uuid,
  appointmentType: z.enum(appointmentTypes).default("NEW"),
  reason: optionalText(300),
  bookedVia: z.enum(bookedViaTypes).default("FRONT_DESK"),
});
const cancelSchema = z.object({ reason: z.string().trim().min(1).max(300) });
const appointmentPatchSchema = z.object({
  status: z.enum(["BOOKED", "CONFIRMED"] as const).optional(),
  reason: optionalText(300),
}).refine((value) => Object.keys(value).length > 0, "Provide at least one appointment field.");
const rescheduleSchema = z.object({
  slotId: uuid,
  reason: optionalText(300),
});
const walkInSchema = z.object({
  patientId: uuid,
  orgUnitId: uuid,
  visitType: z.enum(["OPD", "EMERGENCY"] as const).default("OPD"),
  payerType: z.enum(payerTypes).default("CASH"),
  reason: optionalText(300),
});
const queueActionSchema = z.object({
  counter: optionalText(20),
});
const queueCreateSchema = z.object({
  visitId: uuid,
  stage: z.enum(queueStages),
  priority: z.coerce.number().int().min(1).max(4).default(3),
});

const escapeCsv = (value: string) => value.trim();

/** Parses standard quoted CSV while rejecting malformed quoting rather than misreading columns. */
const parseCsv = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw validationError("The CSV contains an unclosed quoted field.", "CSV_INVALID");
  row.push(value.replace(/\r$/, ""));
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
};

const csvImportSchema = z.object({
  csv: z.string().trim().min(1).max(900_000),
  dryRun: z.boolean().default(true),
});

const priceRangesOverlap = (
  startA: string,
  endA: string | null,
  startB: string,
  endB: string | null,
) => startA <= (endB ?? "9999-12-31") && startB <= (endA ?? "9999-12-31");

router.get("/appointment-references", requireAnyRole([...APPOINTMENT_READ_ROLES]), async (_req, res, next) => {
  try {
    const [units, providers, services] = await Promise.all([
      db.select({ id: orgUnit.id, code: orgUnit.code, name: orgUnit.name })
        .from(orgUnit).where(and(eq(orgUnit.active, true), eq(orgUnit.isClinical, true))).orderBy(asc(orgUnit.name)),
      db.select({
        id: staff.id,
        employeeId: staff.employeeId,
        firstName: staff.firstName,
        lastName: staff.lastName,
      }).from(staff).where(and(eq(staff.status, "active"), eq(staff.staffCategory, "CLINICAL"))).orderBy(asc(staff.lastName), asc(staff.firstName)),
      db.select({ id: serviceItem.id, code: serviceItem.code, name: serviceItem.name })
        .from(serviceItem).where(and(eq(serviceItem.active, true), eq(serviceItem.category, "CONSULTATION"))).orderBy(asc(serviceItem.name)),
    ]);
    const managedIds = await scopedUnitIds(_req);
    const visibleUnits = managedIds === null ? units : units.filter((unit) => managedIds.includes(unit.id));
    res.json({
      data: {
        units: visibleUnits,
        providers: providers.map(({ id, employeeId, firstName, lastName }) => ({
          id, employeeId, name: `${firstName} ${lastName}`,
        })),
        consultationServices: services,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/service-items", requireAnyRole([...CHARGE_READ_ROLES]), async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const active = req.query.active === "false" ? false : true;
    const page = safePage(req.query.page, 1, 100_000);
    const limit = safePage(req.query.limit, 100, 500);
    const rows = await db.select({
      item: serviceItem,
      orgUnitName: orgUnit.name,
    }).from(serviceItem)
      .leftJoin(orgUnit, eq(orgUnit.id, serviceItem.defaultOrgUnitId))
      .where(and(
        eq(serviceItem.active, active),
        q ? or(ilike(serviceItem.name, `%${q}%`), ilike(serviceItem.code, `%${q}%`)) : undefined,
      ))
      .orderBy(asc(serviceItem.name))
      .limit(limit).offset((page - 1) * limit);
    res.json({ data: rows.map(({ item, orgUnitName }) => ({ ...item, defaultOrgUnitName: orgUnitName })) });
  } catch (error) {
    next(error);
  }
});

router.post("/service-items", requireAnyRole([...CHARGE_WRITE_ROLES]), async (req, res, next) => {
  try {
    const input = parseBody(serviceItemSchema, req.body);
    const [created] = await db.insert(serviceItem).values(input).returning();
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch("/service-items/:id", requireAnyRole([...CHARGE_WRITE_ROLES]), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const input = parseBody(serviceItemPatchSchema, req.body);
    const [updated] = await db.update(serviceItem).set(input).where(eq(serviceItem.id, id)).returning();
    if (!updated) throw notFound("Service item not found.", "SERVICE_ITEM_NOT_FOUND");
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.get("/price-lists", requireAnyRole([...CHARGE_READ_ROLES]), async (_req, res, next) => {
  try {
    const rows = await db.select().from(priceList).orderBy(asc(priceList.name));
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

router.post("/price-lists", requireAnyRole([...CHARGE_WRITE_ROLES]), async (req, res, next) => {
  try {
    const input = parseBody(priceListSchema, req.body);
    const [created] = await db.insert(priceList).values(input).returning();
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch("/price-lists/:id", requireAnyRole([...CHARGE_WRITE_ROLES]), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const input = parseBody(priceListPatchSchema, req.body);
    const [updated] = await db.update(priceList).set(input).where(eq(priceList.id, id)).returning();
    if (!updated) throw notFound("Price list not found.", "PRICE_LIST_NOT_FOUND");
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.get("/price-lists/:id/items", requireAnyRole([...CHARGE_READ_ROLES]), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const rows = await db.select({
      item: priceListItem,
      code: serviceItem.code,
      name: serviceItem.name,
      category: serviceItem.category,
    }).from(priceListItem)
      .innerJoin(serviceItem, eq(serviceItem.id, priceListItem.serviceItemId))
      .where(eq(priceListItem.priceListId, id))
      .orderBy(desc(priceListItem.effectiveFrom), asc(serviceItem.name));
    res.json({ data: rows.map(({ item, ...service }) => ({ ...item, service })) });
  } catch (error) {
    next(error);
  }
});

router.post("/price-lists/:id/items", requireAnyRole([...CHARGE_WRITE_ROLES]), async (req, res, next) => {
  try {
    const priceListId = requestId(req, "id");
    const input = parseBody(priceItemSchema, req.body);
    const [created] = await db.insert(priceListItem).values({
      ...input,
      price: input.price.toFixed(2),
      priceListId,
    }).returning();
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch("/price-lists/:id/items/:itemId", requireAnyRole([...CHARGE_WRITE_ROLES]), async (req, res, next) => {
  try {
    const priceListId = requestId(req, "id");
    const itemId = requestId(req, "itemId");
    const input = parseBody(priceItemPatchSchema, req.body);
    const { price, ...fields } = input;
    const [updated] = await db.update(priceListItem).set({
      ...fields,
      ...(price === undefined ? {} : { price: Number(price).toFixed(2) }),
    }).where(and(eq(priceListItem.id, itemId), eq(priceListItem.priceListId, priceListId))).returning();
    if (!updated) throw notFound("Price item not found.", "PRICE_ITEM_NOT_FOUND");
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.post("/price-lists/:id/import", requireAnyRole([...CHARGE_WRITE_ROLES]), async (req, res, next) => {
  try {
    const priceListId = requestId(req, "id");
    const { csv, dryRun } = parseBody(csvImportSchema, req.body);
    const rows = parseCsv(csv);
    const headers = rows.shift()?.map((header) => escapeCsv(header).toLowerCase()) ?? [];
    const expectedHeaders = ["service_code", "price", "effective_from", "effective_to"];
    if (headers.join(",") !== expectedHeaders.join(",")) {
      throw validationError("CSV headers must be service_code,price,effective_from,effective_to.", "CSV_HEADERS_INVALID");
    }
    if (rows.length === 0 || rows.length > 10_000) {
      throw validationError("The CSV must contain between 1 and 10,000 price rows.", "CSV_ROW_COUNT_INVALID");
    }
    const codes = Array.from(new Set(rows.map((row) => escapeCsv(row[0] ?? "")).filter(Boolean)));
    const services = await db.select({
      id: serviceItem.id,
      code: serviceItem.code,
      name: serviceItem.name,
    }).from(serviceItem).where(inArray(serviceItem.code, codes));
    const servicesByCode = new Map(services.map((service) => [service.code, service]));
    const currentPrices = await db.select({
      serviceItemId: priceListItem.serviceItemId,
      effectiveFrom: priceListItem.effectiveFrom,
      effectiveTo: priceListItem.effectiveTo,
    }).from(priceListItem).where(eq(priceListItem.priceListId, priceListId));
    const prepared: Array<{
      row: number;
      serviceItemId: string;
      serviceCode: string;
      price: string;
      effectiveFrom: string;
      effectiveTo: string | null;
    }> = [];
    const errors: Array<{ row: number; message: string }> = [];
    const inputRanges = new Map<string, Array<{ from: string; to: string | null; row: number }>>();
    for (const [index, raw] of rows.entries()) {
      const rowNumber = index + 2;
      const errorCountBeforeRow = errors.length;
      const serviceCode = escapeCsv(raw[0] ?? "");
      const service = servicesByCode.get(serviceCode);
      const price = Number(raw[1]);
      const effectiveFrom = escapeCsv(raw[2] ?? "");
      const effectiveTo = escapeCsv(raw[3] ?? "") || null;
      if (!service) errors.push({ row: rowNumber, message: `Unknown service code "${serviceCode}".` });
      if (!Number.isFinite(price) || price < 0 || !/^\d+(\.\d{1,2})?$/.test(raw[1] ?? "")) {
        errors.push({ row: rowNumber, message: "Price must be a non-negative amount with at most two decimals." });
      }
      if (!dateOnly.safeParse(effectiveFrom).success || (effectiveTo && !dateOnly.safeParse(effectiveTo).success) ||
        (effectiveTo && effectiveTo < effectiveFrom)) {
        errors.push({ row: rowNumber, message: "Provide valid effective_from/effective_to dates." });
      }
      if (!service || !Number.isFinite(price) || price < 0 ||
        !dateOnly.safeParse(effectiveFrom).success ||
        (effectiveTo && (!dateOnly.safeParse(effectiveTo).success || effectiveTo < effectiveFrom))) continue;

      const prior = inputRanges.get(service.id) ?? [];
      if (prior.some((range) => priceRangesOverlap(effectiveFrom, effectiveTo, range.from, range.to))) {
        errors.push({ row: rowNumber, message: "This row overlaps another imported period for the same service." });
      }
      if (currentPrices.some((entry) => entry.serviceItemId === service.id &&
        priceRangesOverlap(effectiveFrom, effectiveTo, entry.effectiveFrom, entry.effectiveTo))) {
        errors.push({ row: rowNumber, message: "This row overlaps an existing dated price for the service." });
      }
      if (errors.length > errorCountBeforeRow) continue;
      prior.push({ from: effectiveFrom, to: effectiveTo, row: rowNumber });
      inputRanges.set(service.id, prior);
      prepared.push({
        row: rowNumber,
        serviceItemId: service.id,
        serviceCode,
        price: price.toFixed(2),
        effectiveFrom,
        effectiveTo,
      });
    }
    const uniqueErrors = errors.filter((error, index) =>
      errors.findIndex((candidate) => candidate.row === error.row && candidate.message === error.message) === index);
    if (!dryRun && uniqueErrors.length > 0) {
      res.status(422).json({
        code: "CSV_IMPORT_INVALID",
        message: "Resolve the CSV issues before importing.",
        data: { validRows: prepared.length, errors: uniqueErrors },
      });
      return;
    }
    if (!dryRun && prepared.length > 0) {
      await db.insert(priceListItem).values(prepared.map((row) => ({
        priceListId,
        serviceItemId: row.serviceItemId,
        price: row.price,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
      })));
    }
    res.json({
      data: {
        dryRun,
        imported: dryRun ? 0 : prepared.length,
        validRows: prepared.length,
        errors: uniqueErrors,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/clinic-session-templates", requireAnyRole([...APPOINTMENT_READ_ROLES]), async (req, res, next) => {
  try {
    const managedIds = await scopedUnitIds(req);
    const rows = await db.select({
      template: clinicSessionTemplate,
      unitName: orgUnit.name,
      providerEmployeeId: staff.employeeId,
      providerFirstName: staff.firstName,
      providerLastName: staff.lastName,
      serviceName: serviceItem.name,
    }).from(clinicSessionTemplate)
      .innerJoin(orgUnit, eq(orgUnit.id, clinicSessionTemplate.orgUnitId))
      .leftJoin(staff, eq(staff.id, clinicSessionTemplate.providerStaffId))
      .leftJoin(serviceItem, eq(serviceItem.id, clinicSessionTemplate.consultationServiceId))
      .where(managedIds === null ? undefined : managedIds.length > 0
        ? inArray(clinicSessionTemplate.orgUnitId, managedIds)
        : sql`false`)
      .orderBy(asc(orgUnit.name), asc(clinicSessionTemplate.weekday), asc(clinicSessionTemplate.startTime));
    res.json({
      data: rows.map(({ template, providerFirstName, providerLastName, ...details }) => ({
        ...template,
        unitName: details.unitName,
        providerName: providerFirstName ? `${providerFirstName} ${providerLastName}` : "Pooled clinic",
        providerEmployeeId: details.providerEmployeeId,
        serviceName: details.serviceName,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/clinic-session-templates", requireAnyRole([...SESSION_WRITE_ROLES]), async (req, res, next) => {
  try {
    const input = parseBody(templateSchema, req.body);
    await checkUnitAccess(req, input.orgUnitId);
    await assertClinicUnit(input.orgUnitId);
    await assertClinicalProvider(input.providerStaffId);
    const [created] = await db.insert(clinicSessionTemplate).values(input).returning();
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch("/clinic-session-templates/:id", requireAnyRole([...SESSION_WRITE_ROLES]), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const input = parseBody(templatePatchSchema, req.body);
    const [existing] = await db.select().from(clinicSessionTemplate)
      .where(eq(clinicSessionTemplate.id, id)).limit(1);
    if (!existing) throw notFound("Clinic session template not found.", "CLINIC_TEMPLATE_NOT_FOUND");
    parseBody(templateSchema, { ...existing, ...input });
    await checkUnitAccess(req, existing.orgUnitId);
    if (input.orgUnitId) {
      await checkUnitAccess(req, input.orgUnitId);
      await assertClinicUnit(input.orgUnitId);
    }
    if (input.providerStaffId !== undefined) await assertClinicalProvider(input.providerStaffId);
    const [updated] = await db.update(clinicSessionTemplate).set(input)
      .where(eq(clinicSessionTemplate.id, id)).returning();
    if (!updated) throw notFound("Clinic session template not found.", "CLINIC_TEMPLATE_NOT_FOUND");
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.get("/appointment-slots", requireAnyRole([...APPOINTMENT_READ_ROLES]), async (req, res, next) => {
  try {
    const unitId = typeof req.query.unitId === "string" ? req.query.unitId : "";
    const from = typeof req.query.from === "string" ? new Date(req.query.from) : new Date();
    const to = typeof req.query.to === "string" ? new Date(req.query.to) : new Date(from.getTime() + 7 * 24 * 60 * 60_000);
    if (!unitId || !uuid.safeParse(unitId).success || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
      throw validationError("Select a clinic and a valid date range.", "SLOT_QUERY_INVALID");
    }
    await checkUnitAccess(req, unitId);
    const conditions = [
      eq(appointmentSlot.orgUnitId, unitId),
      gte(appointmentSlot.startsAt, from),
      lte(appointmentSlot.startsAt, to),
      req.query.available === "true"
        ? and(
          eq(appointmentSlot.status, "OPEN"),
          sql`${appointmentSlot.bookedCount} < ${appointmentSlot.capacity} + COALESCE((
            SELECT t.overbook_limit FROM clinic_session_template t WHERE t.id = ${appointmentSlot.templateId}
          ), 0)`,
        )
        : undefined,
    ];
    if (typeof req.query.providerId === "string" && uuid.safeParse(req.query.providerId).success) {
      conditions.push(eq(appointmentSlot.providerStaffId, req.query.providerId));
    }
    const rows = await db.select({
      slot: appointmentSlot,
      providerEmployeeId: staff.employeeId,
      providerFirstName: staff.firstName,
      providerLastName: staff.lastName,
      overbookLimit: clinicSessionTemplate.overbookLimit,
      unitName: orgUnit.name,
    }).from(appointmentSlot)
      .innerJoin(orgUnit, eq(orgUnit.id, appointmentSlot.orgUnitId))
      .leftJoin(clinicSessionTemplate, eq(clinicSessionTemplate.id, appointmentSlot.templateId))
      .leftJoin(staff, eq(staff.id, appointmentSlot.providerStaffId))
      .where(and(...conditions))
      .orderBy(asc(appointmentSlot.startsAt))
      .limit(1000);
    res.json({
      data: rows.map(({ slot, providerFirstName, providerLastName, ...details }) => ({
        ...slot,
        providerName: providerFirstName ? `${providerFirstName} ${providerLastName}` : "Clinic team",
        providerEmployeeId: details.providerEmployeeId,
        unitName: details.unitName,
        overbookLimit: details.overbookLimit ?? 0,
        remainingCapacity: Math.max(0, slot.capacity + (details.overbookLimit ?? 0) - slot.bookedCount),
        available: slot.status === "OPEN" && slot.bookedCount < slot.capacity + (details.overbookLimit ?? 0),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/appointments", requireAnyRole([...APPOINTMENT_READ_ROLES]), async (req, res, next) => {
  try {
    const from = typeof req.query.from === "string" ? new Date(req.query.from) : new Date(Date.now() - 7 * DAY_MS);
    const to = typeof req.query.to === "string" ? new Date(req.query.to) : new Date(Date.now() + 30 * DAY_MS);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
      throw validationError("Choose a valid appointment date range.", "APPOINTMENT_RANGE_INVALID");
    }
    const requestedUnitId = typeof req.query.unitId === "string" ? req.query.unitId : "";
    if (req.query.unitId !== undefined && !uuid.safeParse(requestedUnitId).success) {
      throw validationError("Choose a valid clinic.", "APPOINTMENT_UNIT_INVALID");
    }
    if (requestedUnitId) await checkUnitAccess(req, requestedUnitId);
    const managedIds = requestedUnitId ? null : await scopedUnitIds(req);
    const status = typeof req.query.status === "string" && appointmentStatuses.includes(req.query.status as typeof appointmentStatuses[number])
      ? req.query.status : null;
    const conditions = [
      gte(appointment.scheduledStart, from),
      lte(appointment.scheduledStart, to),
      status ? eq(appointment.status, status) : undefined,
      requestedUnitId
        ? eq(appointment.orgUnitId, requestedUnitId)
        : managedIds === null
          ? undefined
          : managedIds.length > 0
            ? inArray(appointment.orgUnitId, managedIds)
            : sql`false`,
    ];
    const page = safePage(req.query.page, 1, 100_000);
    const limit = safePage(req.query.limit, 50, 200);
    const rows = await db.select({
      record: appointment,
      patientFirstName: patient.firstName,
      patientLastName: patient.lastName,
      patientId: patient.id,
      patientConfidentiality: patient.confidentiality,
      patientRegisteredUnitId: patient.registeredUnitId,
      unitName: orgUnit.name,
      providerFirstName: staff.firstName,
      providerLastName: staff.lastName,
      providerEmployeeId: staff.employeeId,
    }).from(appointment)
      .innerJoin(patient, eq(patient.id, appointment.patientId))
      .innerJoin(orgUnit, eq(orgUnit.id, appointment.orgUnitId))
      .leftJoin(staff, eq(staff.id, appointment.providerStaffId))
      .where(and(...conditions))
      .orderBy(asc(appointment.scheduledStart))
      .limit(limit).offset((page - 1) * limit);
    const masked = await maskedPatientIds(req, rows.map((row) => ({
      patientId: row.patientId,
      confidentiality: row.patientConfidentiality,
      registeredUnitId: row.patientRegisteredUnitId,
    })));
    res.json({
      data: rows.map(({ record, patientFirstName, patientLastName, patientId, patientConfidentiality, patientRegisteredUnitId, providerFirstName, providerLastName, ...details }) => {
        const restricted = masked.has(patientId);
        const safeAppointment = {
          id: record.id,
          patientName: restricted ? "Restricted record" : `${patientFirstName} ${patientLastName}`,
          scheduledStart: record.scheduledStart,
          scheduledEnd: record.scheduledEnd,
          status: record.status,
          unitName: details.unitName,
        };
        if (restricted) return safeAppointment;
        return {
          ...safeAppointment,
          providerName: providerFirstName ? `${providerFirstName} ${providerLastName}` : "Clinic team",
          providerEmployeeId: details.providerEmployeeId,
          appointmentType: record.appointmentType,
          reason: record.reason,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/appointments", requireAnyRole([...APPOINTMENT_WRITE_ROLES]), async (req, res, next) => {
  try {
    const input = parseBody(bookSchema, req.body);
    const [person] = await db.select({
      id: patient.id,
      status: patient.status,
      deceasedAt: patient.deceasedAt,
      isUnidentified: patient.isUnidentified,
      confidentiality: patient.confidentiality,
      registeredUnitId: patient.registeredUnitId,
    }).from(patient).where(eq(patient.id, input.patientId)).limit(1);
    if (!person || person.status !== "ACTIVE" || person.deceasedAt) {
      throw validationError("Choose an active patient before booking.", "PATIENT_NOT_BOOKABLE");
    }
    if (person.isUnidentified) {
      throw validationError("Identify the patient before booking an appointment.", "PATIENT_IDENTIFY_REQUIRED");
    }
    if ((await maskedPatientIds(req, [{
      patientId: person.id,
      confidentiality: person.confidentiality,
      registeredUnitId: person.registeredUnitId,
    }])).has(person.id)) {
      throw forbidden("You do not have access to book this patient.", "PATIENT_ACCESS_REQUIRED");
    }
    const [targetSlot] = await db.select({ orgUnitId: appointmentSlot.orgUnitId })
      .from(appointmentSlot).where(eq(appointmentSlot.id, input.slotId)).limit(1);
    if (!targetSlot) throw conflict("That appointment slot is no longer available.", "SLOT_FULL");
    await checkUnitAccess(req, targetSlot.orgUnitId);
    const result = await db.execute(sql`
      WITH claimed AS (
        UPDATE appointment_slot s
           SET booked_count = s.booked_count + 1
         WHERE s.id = ${input.slotId}
           AND s.status = 'OPEN'
           AND s.starts_at > now()
           AND s.booked_count < s.capacity + COALESCE((
             SELECT t.overbook_limit FROM clinic_session_template t WHERE t.id = s.template_id
           ), 0)
         RETURNING s.*
      )
      INSERT INTO appointment (
        patient_id, slot_id, org_unit_id, provider_staff_id, appointment_type,
        scheduled_start, scheduled_end, status, reason, booked_via, booked_by
      )
      SELECT ${input.patientId}::uuid, claimed.id, claimed.org_unit_id, claimed.provider_staff_id,
             ${input.appointmentType}, claimed.starts_at, claimed.ends_at, 'BOOKED',
             ${input.reason}, ${input.bookedVia}, ${req.user?.id ?? "system"}
        FROM claimed
      RETURNING id,
                patient_id AS "patientId",
                slot_id AS "slotId",
                org_unit_id AS "orgUnitId",
                provider_staff_id AS "providerStaffId",
                appointment_type AS "appointmentType",
                scheduled_start AS "scheduledStart",
                scheduled_end AS "scheduledEnd",
                status,
                reason,
                booked_via AS "bookedVia",
                booked_by AS "bookedBy",
                cancelled_reason AS "cancelledReason",
                rescheduled_from_id AS "rescheduledFromId",
                reminder_sent_at AS "reminderSentAt",
                checked_in_at AS "checkedInAt",
                visit_id AS "visitId"
    `);
    const created = result.rows[0] as Appointment | undefined;
    if (!created) throw conflict("That appointment slot is no longer available.", "SLOT_FULL");
    res.status(201).json({ data: created });
  } catch (error) {
    if (hasSqlStateCause(error, "23P01")) {
      next(conflict("The patient already has an overlapping appointment.", "PATIENT_APPOINTMENT_OVERLAP"));
      return;
    }
    next(error);
  }
});

router.patch("/appointments/:id", requireAnyRole([...APPOINTMENT_WRITE_ROLES]), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const input = parseBody(appointmentPatchSchema, req.body);
    await ensureAppointmentAccess(req, id);
    const [updated] = await db.update(appointment).set(input)
      .where(and(
        eq(appointment.id, id),
        inArray(appointment.status, ["BOOKED", "CONFIRMED"]),
      ))
      .returning({ id: appointment.id, status: appointment.status, reason: appointment.reason });
    if (!updated) throw conflict("Appointment cannot be updated in its current state.", "APPOINTMENT_UPDATE_NOT_ALLOWED");
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.post("/appointments/:id/cancel", requireAnyRole([...APPOINTMENT_WRITE_ROLES]), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const { reason } = parseBody(cancelSchema, req.body);
    await ensureAppointmentAccess(req, id);
    const result = await db.execute(sql`
      WITH cancelled AS (
        UPDATE appointment
           SET status = 'CANCELLED', cancelled_reason = ${reason}
         WHERE id = ${id}::uuid
           AND status IN ('BOOKED', 'CONFIRMED')
           AND (scheduled_start >= now() + interval '2 hours' OR ${
             Boolean(reason && req.user?.id && roleList(req).some((role) =>
               ["super_admin", "hospital_admin", "unit_manager"].includes(role),
             ))
           })
         RETURNING id, slot_id
      ), released AS (
        UPDATE appointment_slot s
           SET booked_count = GREATEST(0, s.booked_count - 1)
          FROM cancelled c
         WHERE s.id = c.slot_id
         RETURNING s.id
      )
      SELECT c.id FROM cancelled c
    `);
    if (!result.rows[0]) {
      throw conflict("Appointment cannot be cancelled now; a manager override with a reason may be required.", "APPOINTMENT_CANCEL_NOT_ALLOWED");
    }
    res.json({ data: { status: "CANCELLED" } });
  } catch (error) {
    next(error);
  }
});

router.post("/appointments/:id/reschedule", requireAnyRole([...APPOINTMENT_WRITE_ROLES]), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const input = parseBody(rescheduleSchema, req.body);
    await ensureAppointmentAccess(req, id);
    const [targetSlot] = await db.select({ orgUnitId: appointmentSlot.orgUnitId })
      .from(appointmentSlot).where(eq(appointmentSlot.id, input.slotId)).limit(1);
    if (!targetSlot) throw conflict("The new appointment slot is no longer available.", "SLOT_FULL");
    await checkUnitAccess(req, targetSlot.orgUnitId);
    const result = await db.execute(sql`
      WITH old_record AS MATERIALIZED (
        SELECT * FROM appointment
         WHERE id = ${id}::uuid AND status IN ('BOOKED', 'CONFIRMED')
         FOR UPDATE
      ), claimed AS (
        UPDATE appointment_slot s
           SET booked_count = s.booked_count + 1
         WHERE s.id = ${input.slotId}::uuid
           AND s.status = 'OPEN'
           AND s.starts_at > now()
           AND s.booked_count < s.capacity + COALESCE((
             SELECT t.overbook_limit FROM clinic_session_template t WHERE t.id = s.template_id
           ), 0)
           AND EXISTS (SELECT 1 FROM old_record)
           AND s.id IS DISTINCT FROM (SELECT slot_id FROM old_record)
         RETURNING s.*
      ), marked AS (
        UPDATE appointment a
           SET status = 'RESCHEDULED', cancelled_reason = ${input.reason}
          FROM old_record o, claimed c
         WHERE a.id = o.id
         RETURNING a.id, a.patient_id, a.org_unit_id, a.provider_staff_id,
                   a.appointment_type, a.reason, a.booked_via, a.booked_by,
                   a.slot_id, a.scheduled_start
      ), released AS (
        UPDATE appointment_slot s
           SET booked_count = GREATEST(0, s.booked_count - 1)
          FROM marked m
         WHERE s.id = m.slot_id
         RETURNING s.id
      ), created AS (
        INSERT INTO appointment (
          patient_id, slot_id, org_unit_id, provider_staff_id, appointment_type,
          scheduled_start, scheduled_end, status, reason, booked_via, booked_by, rescheduled_from_id
        )
        SELECT m.patient_id, c.id, c.org_unit_id, c.provider_staff_id, m.appointment_type,
               c.starts_at, c.ends_at, 'BOOKED', COALESCE(${input.reason}, m.reason),
               m.booked_via, m.booked_by, m.id
          FROM marked m CROSS JOIN claimed c
        RETURNING id,
                  patient_id AS "patientId",
                  slot_id AS "slotId",
                  org_unit_id AS "orgUnitId",
                  provider_staff_id AS "providerStaffId",
                  appointment_type AS "appointmentType",
                  scheduled_start AS "scheduledStart",
                  scheduled_end AS "scheduledEnd",
                  status,
                  reason,
                  booked_via AS "bookedVia",
                  booked_by AS "bookedBy",
                  cancelled_reason AS "cancelledReason",
                  rescheduled_from_id AS "rescheduledFromId",
                  reminder_sent_at AS "reminderSentAt",
                  checked_in_at AS "checkedInAt",
                  visit_id AS "visitId"
      ), completed_tasks AS (
        UPDATE appointment_rebook_task
           SET status = 'COMPLETED', completed_at = now()
         WHERE appointment_id = ${id}::uuid AND status = 'OPEN'
           AND EXISTS (SELECT 1 FROM created)
         RETURNING id
      )
      SELECT * FROM created
    `);
    const created = result.rows[0] as Appointment | undefined;
    if (!created) throw conflict("The new slot is full or the appointment cannot be rescheduled.", "RESCHEDULE_NOT_AVAILABLE");
    await checkUnitAccess(req, created.orgUnitId);
    res.status(201).json({ data: created });
  } catch (error) {
    if (hasSqlStateCause(error, "23P01")) {
      next(conflict("The patient already has an overlapping appointment.", "PATIENT_APPOINTMENT_OVERLAP"));
      return;
    }
    next(error);
  }
});

router.post("/appointments/:id/check-in", requireAnyRole([...APPOINTMENT_WRITE_ROLES]), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    await ensureAppointmentAccess(req, id);
    const visitId = randomUUID();
    const today = currentDate();
    const result = await db.execute(sql`
      WITH checked AS (
        UPDATE appointment
         SET visit_id = ${visitId}::uuid, status = 'CHECKED_IN', checked_in_at = now()
         WHERE id = ${id}::uuid AND status IN ('BOOKED', 'CONFIRMED')
         RETURNING *
      ), payer_choice AS (
        SELECT c.*,
               COALESCE(coverage.payer_type, 'CASH') AS payer_type,
               coverage.insurance_id
          FROM checked c
          LEFT JOIN LATERAL (
            SELECT py.payer_type, pi.id AS insurance_id
              FROM patient_insurance pi
              JOIN payer py ON py.id = pi.payer_id AND py.active = true
             WHERE pi.patient_id = c.patient_id
               AND pi.status = 'ACTIVE'
               AND pi.is_primary = true
               AND pi.verified_at IS NOT NULL
               AND (pi.card_expiry IS NULL OR pi.card_expiry >= CURRENT_DATE)
             ORDER BY pi.verified_at DESC
             LIMIT 1
          ) coverage ON true
      ), opened AS (
        INSERT INTO visit (
          id, visit_no, patient_id, visit_type, visit_date, payer_type, patient_insurance_id,
          registration_unit_id, current_unit_id, appointment_id, is_new_attendance, status
        )
        SELECT ${visitId}::uuid,
               'OPD-' || replace(${today}, '-', '') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
               c.patient_id, 'OPD', ${today}::date, c.payer_type, c.insurance_id,
               c.org_unit_id, c.org_unit_id, c.id, true, 'OPEN'
          FROM payer_choice c
        RETURNING *
      ), ticket AS (
        INSERT INTO queue_ticket (visit_id, org_unit_id, stage, ticket_no, priority, status)
        SELECT v.id, v.current_unit_id,
               CASE WHEN v.payer_type = 'CASH' THEN 'CASHIER' ELSE 'TRIAGE' END,
               upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
               3, 'WAITING'
          FROM opened v
        RETURNING id, ticket_no, stage
      )
      SELECT v.id AS visit_id, v.visit_no, t.ticket_no, t.stage
        FROM opened v CROSS JOIN ticket t
    `);
    const opened = result.rows[0] as { visit_id: string; visit_no: string; ticket_no: string; stage: string } | undefined;
    if (!opened) throw conflict("This appointment is not ready to check in.", "APPOINTMENT_CHECK_IN_NOT_ALLOWED");
    res.json({ data: opened });
  } catch (error) {
    next(error);
  }
});

router.post("/appointments/:id/complete", requireAnyRole([...APPOINTMENT_WRITE_ROLES]), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    await ensureAppointmentAccess(req, id);
    const [updated] = await db.update(appointment).set({ status: "COMPLETED" })
      .where(and(eq(appointment.id, id), inArray(appointment.status, ["CHECKED_IN", "IN_PROGRESS"])))
      .returning({ status: appointment.status });
    if (!updated) throw conflict("Only a checked-in or in-progress appointment can be completed.", "APPOINTMENT_COMPLETE_NOT_ALLOWED");
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.get("/visits", requireAnyRole([...APPOINTMENT_READ_ROLES]), async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "OPEN";
    const requestedUnitId = typeof req.query.unitId === "string" ? req.query.unitId : "";
    if (req.query.unitId !== undefined && !uuid.safeParse(requestedUnitId).success) {
      throw validationError("Choose a valid clinic.", "APPOINTMENT_UNIT_INVALID");
    }
    if (requestedUnitId) await checkUnitAccess(req, requestedUnitId);
    const managedIds = requestedUnitId ? null : await scopedUnitIds(req);
    const rows = await db.select({
      visit,
      patientName: sql<string>`concat(${patient.firstName}, ' ', ${patient.lastName})`,
      patientId: patient.id,
      confidentiality: patient.confidentiality,
      registeredUnitId: patient.registeredUnitId,
      unitName: orgUnit.name,
    }).from(visit)
      .innerJoin(patient, eq(patient.id, visit.patientId))
      .leftJoin(orgUnit, eq(orgUnit.id, visit.currentUnitId))
      .where(and(
        eq(visit.status, status),
        requestedUnitId
          ? eq(visit.currentUnitId, requestedUnitId)
          : managedIds === null
          ? undefined
          : managedIds.length > 0
            ? inArray(visit.currentUnitId, managedIds)
            : sql`false`,
      ))
      .orderBy(desc(visit.openedAt))
      .limit(200);
    const masked = await maskedPatientIds(req, rows.map((row) => ({
      patientId: row.patientId,
      confidentiality: row.confidentiality,
      registeredUnitId: row.registeredUnitId,
    })));
    res.json({ data: rows.map(({ patientId, confidentiality, registeredUnitId, ...row }) => ({
      ...row,
      patientName: masked.has(patientId) ? "Restricted record" : row.patientName,
    })) });
  } catch (error) {
    next(error);
  }
});

router.post("/visits", requireAnyRole([...APPOINTMENT_WRITE_ROLES]), async (req, res, next) => {
  try {
    const input = parseBody(walkInSchema, req.body);
    await checkUnitAccess(req, input.orgUnitId);
    const [person] = await db.select({
      id: patient.id,
      status: patient.status,
      deceasedAt: patient.deceasedAt,
      confidentiality: patient.confidentiality,
      registeredUnitId: patient.registeredUnitId,
    })
      .from(patient).where(eq(patient.id, input.patientId)).limit(1);
    if (!person || person.status !== "ACTIVE" || person.deceasedAt) {
      throw validationError("Choose an active patient before opening a visit.", "PATIENT_NOT_BOOKABLE");
    }
    if ((await maskedPatientIds(req, [{
      patientId: person.id,
      confidentiality: person.confidentiality,
      registeredUnitId: person.registeredUnitId,
    }])).has(person.id)) {
      throw forbidden("You do not have access to open a visit for this patient.", "PATIENT_ACCESS_REQUIRED");
    }
    const appointmentId = randomUUID();
    const visitId = randomUUID();
    const result = await db.execute(sql`
      WITH new_appointment AS (
        INSERT INTO appointment (
          id, patient_id, org_unit_id, appointment_type, scheduled_start, scheduled_end,
          status, reason, booked_via, booked_by, visit_id
        ) VALUES (
          ${appointmentId}::uuid, ${input.patientId}::uuid, ${input.orgUnitId}::uuid, 'WALK_IN',
          now(), now() + interval '15 minutes', 'CHECKED_IN', ${input.reason}, 'FRONT_DESK',
          ${req.user?.id ?? "system"}, ${visitId}::uuid
        )
        RETURNING *
      ), new_visit AS (
        INSERT INTO visit (
          id, visit_no, patient_id, visit_type, visit_date, payer_type,
          registration_unit_id, current_unit_id, appointment_id, is_new_attendance, status
        )
        SELECT ${visitId}::uuid,
               'OPD-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
               a.patient_id, ${input.visitType}, now()::date, ${input.payerType},
               a.org_unit_id, a.org_unit_id, a.id, false, 'OPEN'
          FROM new_appointment a
        RETURNING *
      ), ticket AS (
        INSERT INTO queue_ticket (visit_id, org_unit_id, stage, ticket_no, priority, status)
        SELECT v.id, v.current_unit_id, CASE WHEN v.visit_type = 'EMERGENCY' THEN 'TRIAGE'
                                            WHEN v.payer_type = 'CASH' THEN 'CASHIER' ELSE 'TRIAGE' END,
               upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
               CASE WHEN v.visit_type = 'EMERGENCY' THEN 1 ELSE 3 END, 'WAITING'
          FROM new_visit v
        RETURNING ticket_no, stage
      )
      SELECT v.id AS visit_id, v.visit_no, t.ticket_no, t.stage
        FROM new_visit v CROSS JOIN ticket t
    `);
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.post("/visits/:id/close", requireAnyRole([...APPOINTMENT_WRITE_ROLES]), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    await ensureVisitAccess(req, id);
    const [updated] = await db.update(visit).set({ status: "CLOSED", closedAt: new Date() })
      .where(and(eq(visit.id, id), eq(visit.status, "OPEN"))).returning({ status: visit.status });
    if (!updated) throw conflict("Visit is not open.", "VISIT_NOT_OPEN");
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

const loadQueue = async (req: Request, unitId: string, stage?: string) => {
  const rows = await db.select({
    ticket: queueTicket,
    visitNo: visit.visitNo,
    patientName: sql<string>`concat(${patient.firstName}, ' ', ${patient.lastName})`,
    patientId: patient.id,
    confidentiality: patient.confidentiality,
    registeredUnitId: patient.registeredUnitId,
    unitName: orgUnit.name,
  }).from(queueTicket)
    .innerJoin(visit, eq(visit.id, queueTicket.visitId))
    .innerJoin(patient, eq(patient.id, visit.patientId))
    .innerJoin(orgUnit, eq(orgUnit.id, queueTicket.orgUnitId))
    .where(and(
      eq(queueTicket.orgUnitId, unitId),
      inArray(queueTicket.status, ["WAITING", "CALLED", "SERVING"]),
      stage ? eq(queueTicket.stage, stage) : undefined,
    ))
    .orderBy(asc(queueTicket.priority), asc(queueTicket.issuedAt))
    .limit(200);
  const masked = await maskedPatientIds(req, rows.map((row) => ({
    patientId: row.patientId,
    confidentiality: row.confidentiality,
    registeredUnitId: row.registeredUnitId,
  })));
  return rows.map(({ patientId, confidentiality, registeredUnitId, ...row }) => ({
    ...row,
    patientName: masked.has(patientId) ? "Restricted record" : row.patientName,
  }));
};

router.get("/queue", requireAnyRole([...APPOINTMENT_READ_ROLES]), async (req, res, next) => {
  try {
    const unitId = typeof req.query.unitId === "string" ? req.query.unitId : "";
    const stage = typeof req.query.stage === "string" && queueStages.includes(req.query.stage as typeof queueStages[number])
      ? req.query.stage : undefined;
    if (!uuid.safeParse(unitId).success) throw validationError("Select a clinic.", "QUEUE_UNIT_REQUIRED");
    await checkUnitAccess(req, unitId);
    res.json({ data: await loadQueue(req, unitId, stage) });
  } catch (error) {
    next(error);
  }
});

router.post("/queue", requireAnyRole([...APPOINTMENT_WRITE_ROLES]), async (req, res, next) => {
  try {
    const input = parseBody(queueCreateSchema, req.body);
    const [visitRecord] = await db.select({
      visitId: visit.id,
      unitId: visit.currentUnitId,
      patientId: patient.id,
      confidentiality: patient.confidentiality,
    }).from(visit)
      .innerJoin(patient, eq(patient.id, visit.patientId))
      .where(and(eq(visit.id, input.visitId), eq(visit.status, "OPEN")))
      .limit(1);
    if (!visitRecord || !visitRecord.unitId) throw notFound("Open visit not found.", "VISIT_NOT_FOUND");
    await checkUnitAccess(req, visitRecord.unitId);
    await assertChartAccess(req, patientActor(req), {
      id: visitRecord.patientId,
      confidentiality: visitRecord.confidentiality,
    }, "queue_ticket");
    const [created] = await db.insert(queueTicket).values({
      visitId: visitRecord.visitId,
      orgUnitId: visitRecord.unitId,
      stage: input.stage,
      ticketNo: randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase(),
      priority: input.priority,
      status: "WAITING",
    }).returning({
      id: queueTicket.id,
      ticketNo: queueTicket.ticketNo,
      stage: queueTicket.stage,
      priority: queueTicket.priority,
    });
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.get("/queue/stream", requireAnyRole([...APPOINTMENT_READ_ROLES]), async (req, res, next) => {
  try {
    const unitId = typeof req.query.unitId === "string" ? req.query.unitId : "";
    if (!uuid.safeParse(unitId).success) throw validationError("Select a clinic.", "QUEUE_UNIT_REQUIRED");
    await checkUnitAccess(req, unitId);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    let sending = false;
    req.once("close", () => {
      active = false;
      if (timer) clearInterval(timer);
    });
    const send = async () => {
      if (!active || sending) return;
      sending = true;
      try {
        const queue = await loadQueue(req, unitId);
        if (active) res.write(`data: ${JSON.stringify(queue)}\n\n`);
      } catch (error) {
        console.error("Queue event stream update failed.", error);
        if (active) res.write("event: error\ndata: {}\n\n");
      } finally {
        sending = false;
      }
    };
    await send();
    if (active) timer = setInterval(() => void send(), 3000);
  } catch (error) {
    next(error);
  }
});

const queueAction = (action: "call" | "recall" | "serve" | "skip" | "complete") =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = requestId(req, "id");
      const [ticket] = await db.select({
        unitId: queueTicket.orgUnitId,
        patientId: patient.id,
        confidentiality: patient.confidentiality,
      }).from(queueTicket)
        .innerJoin(visit, eq(visit.id, queueTicket.visitId))
        .innerJoin(patient, eq(patient.id, visit.patientId))
        .where(eq(queueTicket.id, id))
        .limit(1);
      if (!ticket) throw notFound("Queue ticket not found.", "QUEUE_TICKET_NOT_FOUND");
      await checkUnitAccess(req, ticket.unitId);
      await assertChartAccess(req, patientActor(req), {
        id: ticket.patientId,
        confidentiality: ticket.confidentiality,
      }, "queue_ticket");
      const input = parseBody(queueActionSchema, req.body ?? {});
      const update = action === "call"
        ? { status: "CALLED", calledAt: new Date(), calledBy: req.user?.id ?? null, counter: input.counter }
        : action === "recall"
          ? { status: "CALLED", calledAt: new Date(), calledBy: req.user?.id ?? null, counter: input.counter, recallCount: sql`${queueTicket.recallCount} + 1` }
          : action === "serve"
            ? { status: "SERVING", startedAt: new Date() }
            : action === "skip"
            ? { status: "SKIPPED", completedAt: new Date() }
            : { status: "DONE", completedAt: new Date() };
      const allowedStatuses = action === "call" ? ["WAITING"] : action === "recall" ? ["CALLED"] : action === "serve" ? ["CALLED"] : ["WAITING", "CALLED", "SERVING"];
      const [updated] = await db.update(queueTicket).set(update)
        .where(and(eq(queueTicket.id, id), inArray(queueTicket.status, allowedStatuses)))
        .returning({ status: queueTicket.status });
      if (!updated) throw conflict("This queue ticket cannot make that transition.", "QUEUE_TRANSITION_NOT_ALLOWED");
      res.json({ data: updated });
    } catch (error) {
      next(error);
    }
  };

router.post("/queue/:id/call", requireAnyRole([...APPOINTMENT_WRITE_ROLES]), queueAction("call"));
router.post("/queue/:id/recall", requireAnyRole([...APPOINTMENT_WRITE_ROLES]), queueAction("recall"));
router.post("/queue/:id/serve", requireAnyRole([...APPOINTMENT_WRITE_ROLES]), queueAction("serve"));
router.post("/queue/:id/skip", requireAnyRole([...APPOINTMENT_WRITE_ROLES]), queueAction("skip"));
router.post("/queue/:id/complete", requireAnyRole([...APPOINTMENT_WRITE_ROLES]), queueAction("complete"));

router.get("/appointment-rebook-tasks", requireAnyRole([...APPOINTMENT_READ_ROLES]), async (req, res, next) => {
  try {
    const requestedUnitId = typeof req.query.unitId === "string" ? req.query.unitId : "";
    if (req.query.unitId !== undefined && !uuid.safeParse(requestedUnitId).success) {
      throw validationError("Choose a valid clinic.", "APPOINTMENT_UNIT_INVALID");
    }
    if (requestedUnitId) await checkUnitAccess(req, requestedUnitId);
    const managedIds = requestedUnitId ? null : await scopedUnitIds(req);
    const page = safePage(req.query.page, 1, 100_000);
    const limit = safePage(req.query.limit, 50, 200);
    const rows = await db.select({
      task: appointmentRebookTask,
      appointment: appointment,
      patientName: sql<string>`concat(${patient.firstName}, ' ', ${patient.lastName})`,
      patientId: patient.id,
      confidentiality: patient.confidentiality,
      registeredUnitId: patient.registeredUnitId,
      unitName: orgUnit.name,
    }).from(appointmentRebookTask)
      .innerJoin(appointment, eq(appointment.id, appointmentRebookTask.appointmentId))
      .innerJoin(patient, eq(patient.id, appointment.patientId))
      .innerJoin(orgUnit, eq(orgUnit.id, appointment.orgUnitId))
      .where(and(
        eq(appointmentRebookTask.status, "OPEN"),
        requestedUnitId
          ? eq(appointment.orgUnitId, requestedUnitId)
          : managedIds === null
          ? undefined
          : managedIds.length > 0
            ? inArray(appointment.orgUnitId, managedIds)
            : sql`false`,
      ))
      .orderBy(asc(appointmentRebookTask.createdAt))
      .limit(limit).offset((page - 1) * limit);
    const masked = await maskedPatientIds(req, rows.map((row) => ({
      patientId: row.patientId,
      confidentiality: row.confidentiality,
      registeredUnitId: row.registeredUnitId,
    })));
    res.json({ data: rows.map((row) => {
      const restricted = masked.has(row.patientId);
      return {
        task: row.task,
        appointment: restricted
          ? {
            id: row.appointment.id,
            scheduledStart: row.appointment.scheduledStart,
            scheduledEnd: row.appointment.scheduledEnd,
            status: row.appointment.status,
          }
          : row.appointment,
        patientName: restricted ? "Restricted record" : row.patientName,
        unitName: row.unitName,
      };
    }) });
  } catch (error) {
    next(error);
  }
});

router.post("/appointment-rebook-tasks/:id/cancel", requireAnyRole([...APPOINTMENT_WRITE_ROLES]), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const [task] = await db.select({
      unitId: appointment.orgUnitId,
      patientId: patient.id,
      confidentiality: patient.confidentiality,
    }).from(appointmentRebookTask)
      .innerJoin(appointment, eq(appointment.id, appointmentRebookTask.appointmentId))
      .innerJoin(patient, eq(patient.id, appointment.patientId))
      .where(eq(appointmentRebookTask.id, id))
      .limit(1);
    if (!task) throw notFound("Rebooking task not found.", "REBOOK_TASK_NOT_FOUND");
    await checkUnitAccess(req, task.unitId);
    await assertChartAccess(req, patientActor(req), {
      id: task.patientId,
      confidentiality: task.confidentiality,
    }, "appointment_rebook_task");
    const [updated] = await db.update(appointmentRebookTask)
      .set({ status: "CANCELLED", completedAt: new Date() })
      .where(and(eq(appointmentRebookTask.id, id), eq(appointmentRebookTask.status, "OPEN")))
      .returning({ status: appointmentRebookTask.status });
    if (!updated) throw notFound("Rebooking task not found.", "REBOOK_TASK_NOT_FOUND");
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

export default router;
