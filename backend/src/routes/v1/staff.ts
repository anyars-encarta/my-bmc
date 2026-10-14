import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import {
  insertStaffSchema,
  jobRole,
  orgUnit,
  staff,
  staffAssignment,
  staffLicense,
  updateStaffSchema,
} from "../../db/schema/index.js";
import { badRequest, forbidden, notFound, validationError } from "../../lib/errors.js";
import { parseListQuery, toPageResponse } from "../../lib/listQuery.js";
import { isAppRole, requireAnyRole } from "../../lib/platform.js";
import { resolveManagedUnitIds } from "../../lib/unitAccess.js";

const router = Router();

const STAFF_WRITE_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER", "PAYROLL_OFFICER"] as const;

const licenseCreateSchema = z.object({
  licensingBody: z.enum(["MDC", "NMC", "PC", "HPC", "AHPC", "OTHER"]),
  licenceNo: z.string().min(1).max(40),
  issuedOn: z.string().date().optional(),
  expiresOn: z.string().date(),
  status: z.enum(["ACTIVE", "EXPIRED", "SUSPENDED", "REVOKED"]).default("ACTIVE"),
  attachmentId: z.string().uuid().optional(),
  note: z.string().max(300).optional(),
});

const staffCreateSchema = insertStaffSchema
  .extend({
    userId: z.string().optional(),
    orgUnitId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.staffCategory === "NON_CLINICAL" && value.scheduleMode !== "FIXED_WEEKDAY") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduleMode"],
        message: "Non-clinical staff must use FIXED_WEEKDAY schedule mode.",
      });
    }
  });

const parseRouteId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const mapSort = (field: string, descending: boolean) => {
  if (field === "firstName") return descending ? desc(staff.firstName) : asc(staff.firstName);
  if (field === "lastName") return descending ? desc(staff.lastName) : asc(staff.lastName);
  if (field === "email") return descending ? desc(staff.email) : asc(staff.email);
  if (field === "employeeId") return descending ? desc(staff.employeeId) : asc(staff.employeeId);
  return descending ? desc(staff.createdAt) : asc(staff.createdAt);
};

const canViewPayout = (roles: string[]) =>
  roles.some((role) => ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER", "PAYROLL_OFFICER"].includes(role));

const sanitizeStaffRecord = (record: typeof staff.$inferSelect, roles: string[]) => {
  if (canViewPayout(roles)) {
    return record;
  }

  return {
    ...record,
    momoName: null,
    momoNumber: "***********",
  };
};

const parseAppRoles = (roles: string[] | undefined) =>
  (roles ?? []).filter((role): role is Parameters<typeof resolveManagedUnitIds>[1][number] => isAppRole(role));

const validateJobRoleCategory = async (jobRoleId: string | null | undefined, staffCategory: string | undefined) => {
  if (!jobRoleId || !staffCategory) return;
  const [role] = await db.select().from(jobRole).where(eq(jobRole.id, jobRoleId)).limit(1);
  if (!role) {
    throw validationError("Job role not found.", "JOB_ROLE_NOT_FOUND");
  }
  if (role.staffCategory !== staffCategory) {
    throw validationError(
      "Job role category must match staff category.",
      "STAFF_JOB_ROLE_CATEGORY_MISMATCH",
      { expected: staffCategory, actual: role.staffCategory },
    );
  }
};

const ensureStaffRules = async (payload: Partial<typeof staff.$inferInsert>) => {
  const category = payload.staffCategory;
  const mode = payload.scheduleMode;
  if (category === "NON_CLINICAL" && mode && mode !== "FIXED_WEEKDAY") {
    throw validationError(
      "Non-clinical staff cannot be rostered.",
      "STAFF_NONCLINICAL_FIXED",
      { staffCategory: category, scheduleMode: mode },
    );
  }
  await validateJobRoleCategory(payload.jobRoleId, category);
};

const attachCurrentOrgUnits = async <T extends { id: string }>(rows: T[]) => {
  if (rows.length === 0) return rows.map((row) => ({ ...row, orgUnitId: null }));

  const today = new Date().toISOString().slice(0, 10);
  const assignments = await db
    .select({
      staffId: staffAssignment.staffId,
      orgUnitId: staffAssignment.orgUnitId,
      effectiveFrom: staffAssignment.effectiveFrom,
    })
    .from(staffAssignment)
    .where(
      and(
        inArray(
          staffAssignment.staffId,
          rows.map((row) => row.id),
        ),
        lte(staffAssignment.effectiveFrom, today),
        or(isNull(staffAssignment.effectiveTo), gte(staffAssignment.effectiveTo, today)),
      ),
    )
    .orderBy(desc(staffAssignment.effectiveFrom));

  const orgByStaff = new Map<string, string>();
  for (const assignment of assignments) {
    if (!orgByStaff.has(assignment.staffId)) {
      orgByStaff.set(assignment.staffId, assignment.orgUnitId);
    }
  }

  return rows.map((row) => ({ ...row, orgUnitId: orgByStaff.get(row.id) ?? null }));
};

const ensureManagedStaffAccess = async (
  user: { id?: string; roles?: string[] } | undefined,
  staffId: string,
) => {
  const [existing] = await db.select({ id: staff.id }).from(staff).where(eq(staff.id, staffId)).limit(1);
  if (!existing) {
    throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
  }

  const managedIds = user?.id ? await resolveManagedUnitIds(user.id, parseAppRoles(user.roles)) : [];
  if (managedIds === null) {
    return;
  }
  if (managedIds.length === 0) {
    throw forbidden("You do not have access to this staff member.", "STAFF_FORBIDDEN");
  }

  const today = new Date().toISOString().slice(0, 10);
  const [currentAssignment] = await db
    .select({ orgUnitId: staffAssignment.orgUnitId })
    .from(staffAssignment)
    .where(
      and(
        eq(staffAssignment.staffId, staffId),
        eq(staffAssignment.assignmentType, "PRIMARY"),
        lte(staffAssignment.effectiveFrom, today),
        or(isNull(staffAssignment.effectiveTo), gte(staffAssignment.effectiveTo, today)),
      ),
    )
    .orderBy(desc(staffAssignment.effectiveFrom))
    .limit(1);

  if (!currentAssignment || !managedIds.includes(currentAssignment.orgUnitId)) {
    throw forbidden("You do not have access to this staff member.", "STAFF_FORBIDDEN");
  }
};

router.get("/", async (req, res, next) => {
  try {
    const query = parseListQuery(req, {
      sortable: ["firstName", "lastName", "email", "employeeId", "createdAt"],
      filterable: ["status", "department", "staffCategory", "scheduleMode", "orgUnitId", "jobRoleId"],
      defaultSort: "-createdAt",
    });

    const roles = req.user?.roles ?? [];
    const managedIds = req.user?.id ? await resolveManagedUnitIds(req.user.id, parseAppRoles(roles)) : [];

    const filters = [];
    if (query.q) {
      filters.push(
        or(
          ilike(staff.firstName, `%${query.q}%`),
          ilike(staff.lastName, `%${query.q}%`),
          ilike(staff.email, `%${query.q}%`),
          ilike(staff.employeeId, `%${query.q}%`),
        ),
      );
    }

    let filterOrgUnitId: string | null = null;
    for (const filter of query.filters) {
      if (filter.operator !== "eq" || typeof filter.value !== "string") {
        continue;
      }
      if (filter.field === "status") filters.push(eq(staff.status, filter.value as "active" | "inactive"));
      if (filter.field === "department") filters.push(eq(staff.department, filter.value));
      if (filter.field === "staffCategory") filters.push(eq(staff.staffCategory, filter.value as "CLINICAL" | "NON_CLINICAL"));
      if (filter.field === "scheduleMode") filters.push(eq(staff.scheduleMode, filter.value as "FIXED_WEEKDAY" | "ROSTERED"));
      if (filter.field === "jobRoleId") filters.push(eq(staff.jobRoleId, filter.value));
      if (filter.field === "orgUnitId") filterOrgUnitId = filter.value;
    }

    const today = new Date().toISOString().slice(0, 10);
    const whereParts = [...filters];
    if (managedIds !== null) {
      if (managedIds.length === 0) {
        res.json(toPageResponse([], query, 0));
        return;
      }

      whereParts.push(
        sql`exists (
          select 1
          from ${staffAssignment}
          where ${staffAssignment.staffId} = ${staff.id}
            and ${staffAssignment.assignmentType} = 'PRIMARY'
            and ${staffAssignment.effectiveFrom} <= ${today}
            and (${staffAssignment.effectiveTo} is null or ${staffAssignment.effectiveTo} >= ${today})
            and ${staffAssignment.orgUnitId} in (${sql.join(managedIds.map((id) => sql`${id}`), sql`, `)})
        )`,
      );
    }
    if (filterOrgUnitId) {
      whereParts.push(
        sql`exists (
          select 1
          from ${staffAssignment}
          where ${staffAssignment.staffId} = ${staff.id}
            and ${staffAssignment.assignmentType} = 'PRIMARY'
            and ${staffAssignment.effectiveFrom} <= ${today}
            and (${staffAssignment.effectiveTo} is null or ${staffAssignment.effectiveTo} >= ${today})
            and ${staffAssignment.orgUnitId} = ${filterOrgUnitId}
        )`,
      );
    }

    const where = whereParts.length > 0 ? and(...whereParts) : undefined;
    const sort = query.sort[0] ?? { field: "createdAt", descending: true };
    const [rows, totalRows] = await Promise.all([
      db.select().from(staff).where(where).orderBy(mapSort(sort.field, sort.descending)).limit(query.limit).offset(query.offset),
      db.select({ total: count() }).from(staff).where(where),
    ]);

    const withUnits = await attachCurrentOrgUnits(rows);

    res.json(
      toPageResponse(
        withUnits.map((row) => sanitizeStaffRecord(row, roles)),
        query,
        Number(totalRows[0]?.total ?? withUnits.length),
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/", requireAnyRole([...STAFF_WRITE_ROLES]), async (req, res, next) => {
  try {
    const parsed = staffCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    await ensureStaffRules(parsed.data);

    const created = await db.transaction(async (tx) => {
      const [createdStaff] = await tx.insert(staff).values(parsed.data).returning();
      if (!createdStaff) {
        throw badRequest("Unable to create staff member.", "STAFF_CREATE_FAILED");
      }
      if (parsed.data.orgUnitId) {
        await tx.insert(staffAssignment).values({
          staffId: createdStaff.id,
          orgUnitId: parsed.data.orgUnitId,
          assignmentType: "PRIMARY",
          effectiveFrom: parsed.data.hireDate ?? new Date().toISOString().slice(0, 10),
          reason: "INITIAL",
        });
      }
      return createdStaff;
    });

    res.status(201).json({ data: sanitizeStaffRecord(created, req.user?.roles ?? []) });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const staffId = parseRouteId(req.params.id);
    if (!staffId) {
      throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
    }

    await ensureManagedStaffAccess(req.user, staffId);

    const [record] = await db.select().from(staff).where(eq(staff.id, staffId)).limit(1);
    if (!record) {
      throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
    }

    const [withUnit] = await attachCurrentOrgUnits([record]);
    res.json({ data: sanitizeStaffRecord(withUnit ?? { ...record, orgUnitId: null }, req.user?.roles ?? []) });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireAnyRole([...STAFF_WRITE_ROLES]), async (req, res, next) => {
  try {
    const staffId = parseRouteId(req.params.id);
    if (!staffId) {
      throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
    }

    const parsed = updateStaffSchema
      .extend({ orgUnitId: z.string().uuid().optional() })
      .safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const [existing] = await db.select().from(staff).where(eq(staff.id, staffId)).limit(1);
    if (!existing) {
      throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
    }

    const mergedForValidation = {
      ...existing,
      ...Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined)),
    };
    await ensureStaffRules(mergedForValidation);

    const updatePayload = Object.fromEntries(
      Object.entries(parsed.data).filter(([key, value]) => key !== "orgUnitId" && value !== undefined),
    );

    const [updated] = await db
      .update(staff)
      .set({ ...updatePayload, updatedAt: new Date() })
      .where(eq(staff.id, staffId))
      .returning();

    if (!updated) {
      throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
    }

    if (parsed.data.orgUnitId) {
      const today = new Date().toISOString().slice(0, 10);
      const [current] = await db
        .select()
        .from(staffAssignment)
        .where(
          and(
            eq(staffAssignment.staffId, staffId),
            eq(staffAssignment.assignmentType, "PRIMARY"),
            lte(staffAssignment.effectiveFrom, today),
            or(isNull(staffAssignment.effectiveTo), gte(staffAssignment.effectiveTo, today)),
          ),
        )
        .orderBy(desc(staffAssignment.effectiveFrom))
        .limit(1);

      if (!current || current.orgUnitId !== parsed.data.orgUnitId) {
        if (current && current.effectiveTo === null) {
          await db
            .update(staffAssignment)
            .set({ effectiveTo: today })
            .where(eq(staffAssignment.id, current.id));
        }
        await db.insert(staffAssignment).values({
          staffId,
          orgUnitId: parsed.data.orgUnitId,
          assignmentType: "PRIMARY",
          effectiveFrom: today,
          reason: "TRANSFER",
        });
      }
    }

    const [withUnit] = await attachCurrentOrgUnits([updated]);
    res.json({ data: sanitizeStaffRecord(withUnit ?? { ...updated, orgUnitId: null }, req.user?.roles ?? []) });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/deactivate", requireAnyRole(["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"]), async (req, res, next) => {
  try {
    const staffId = parseRouteId(req.params.id);
    if (!staffId) {
      throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
    }

    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) {
      throw validationError("Deactivation reason is required.", "STAFF_DEACTIVATION_REASON_REQUIRED");
    }

    const [updated] = await db
      .update(staff)
      .set({ status: "inactive", terminationDate: new Date().toISOString().slice(0, 10), updatedAt: new Date() })
      .where(eq(staff.id, staffId))
      .returning();

    if (!updated) {
      throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
    }

    res.json({ data: { ...updated, deactivationReason: reason } });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/licenses", async (req, res, next) => {
  try {
    const staffId = parseRouteId(req.params.id);
    if (!staffId) {
      throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
    }

    await ensureManagedStaffAccess(req.user, staffId);

    const list = await db.select().from(staffLicense).where(eq(staffLicense.staffId, staffId)).orderBy(desc(staffLicense.expiresOn));
    res.json({ data: list });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/licenses", requireAnyRole(["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"]), async (req, res, next) => {
  try {
    const staffId = parseRouteId(req.params.id);
    if (!staffId) {
      throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
    }

    const parsed = licenseCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const [created] = await db.insert(staffLicense).values({ ...parsed.data, staffId }).returning();
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/licenses/:licenseId", requireAnyRole(["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"]), async (req, res, next) => {
  try {
    const staffId = parseRouteId(req.params.id);
    const licenseId = parseRouteId(req.params.licenseId);
    if (!staffId || !licenseId) {
      throw badRequest("Staff ID and license ID are required.", "STAFF_LICENSE_ID_REQUIRED");
    }

    const parsed = licenseCreateSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const updateData = Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined),
    );
    const [updated] = await db
      .update(staffLicense)
      .set(updateData)
      .where(and(eq(staffLicense.id, licenseId), eq(staffLicense.staffId, staffId)))
      .returning();

    if (!updated) {
      throw notFound("License not found.", "STAFF_LICENSE_NOT_FOUND");
    }

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/migrations/department-org-units/dry-run",
  requireAnyRole(["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"]),
  async (_req, res, next) => {
    try {
      const staffRows = await db.select().from(staff).orderBy(asc(staff.department), asc(staff.lastName));
      const existingUnits = await db.select().from(orgUnit);
      const byName = new Map(existingUnits.map((unit) => [unit.name.trim().toLowerCase(), unit]));

      const normalizedDepartments = new Map<
        string,
        { rawValue: string; staffCount: number; mappedOrgUnitId: string | null; unmappedStaffIds: string[] }
      >();

      for (const row of staffRows) {
        const raw = (row.department ?? "").trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        const existing = normalizedDepartments.get(key) ?? {
          rawValue: raw,
          staffCount: 0,
          mappedOrgUnitId: byName.get(key)?.id ?? null,
          unmappedStaffIds: [],
        };
        existing.staffCount += 1;
        if (!existing.mappedOrgUnitId) {
          existing.unmappedStaffIds.push(row.id);
        }
        normalizedDepartments.set(key, existing);
      }

      const report = Array.from(normalizedDepartments.values()).sort((a, b) =>
        a.rawValue.localeCompare(b.rawValue),
      );
      res.json({
        data: {
          totalDepartments: report.length,
          unmappedDepartments: report.filter((row) => !row.mappedOrgUnitId).length,
          report,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/migrations/department-org-units/apply",
  requireAnyRole(["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"]),
  async (_req, res, next) => {
    try {
      const staffRows = await db.select().from(staff).where(eq(staff.status, "active"));
      const existingUnits = await db.select().from(orgUnit);
      const byName = new Map(existingUnits.map((unit) => [unit.name.trim().toLowerCase(), unit]));
      const existingCodes = new Set(existingUnits.map((unit) => unit.code.toUpperCase()));
      const createdUnitIds: string[] = [];
      const today = new Date().toISOString().slice(0, 10);

      await db.transaction(async (tx) => {
        for (const row of staffRows) {
          const department = (row.department ?? "").trim();
          if (!department) continue;
          const key = department.toLowerCase();
          let unit = byName.get(key);

          if (!unit) {
            const baseCode =
              department
              .toUpperCase()
              .replace(/[^A-Z0-9]+/g, "_")
              .replace(/^_+|_+$/g, "")
              .slice(0, 30) || `UNIT_${createdUnitIds.length + 1}`;
            let code = baseCode;
            let suffix = 2;
            while (existingCodes.has(code)) {
              const suffixText = `_${suffix}`;
              code = `${baseCode.slice(0, Math.max(1, 30 - suffixText.length))}${suffixText}`;
              suffix += 1;
            }

            const [createdUnit] = await tx
              .insert(orgUnit)
              .values({
                code,
                name: department,
                unitType: "DEPARTMENT",
                isClinical: false,
                operates24h: false,
                active: true,
              })
              .returning();
            if (!createdUnit) {
              throw badRequest("Unable to create org unit for department migration.", "ORG_UNIT_CREATE_FAILED");
            }
            unit = createdUnit;
            byName.set(key, unit);
            existingCodes.add(code);
            createdUnitIds.push(unit.id);
          }

          const [existingPrimary] = await tx
            .select()
            .from(staffAssignment)
            .where(and(eq(staffAssignment.staffId, row.id), eq(staffAssignment.assignmentType, "PRIMARY")))
            .limit(1);

          if (!existingPrimary) {
            await tx.insert(staffAssignment).values({
              staffId: row.id,
              orgUnitId: unit.id,
              assignmentType: "PRIMARY",
              effectiveFrom: row.hireDate ?? today,
              reason: "INITIAL",
            });
          }
        }
      });

      res.json({ data: { createdUnits: createdUnitIds.length, message: "Department migration applied." } });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
