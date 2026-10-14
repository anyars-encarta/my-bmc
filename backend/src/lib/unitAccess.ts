import { eq, inArray } from "drizzle-orm";

import { db } from "../db/index.js";
import { orgUnit, staff, userUnitScope } from "../db/schema/index.js";
import type { AppRole } from "./platform.js";

const ORG_ADMIN_ROLES: AppRole[] = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"];
const SCOPED_MANAGER_ROLES: AppRole[] = ["UNIT_MANAGER", "ROSTER_OFFICER"];

const buildChildrenMap = (rows: Array<{ id: string; parentId: string | null }>) => {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const list = children.get(row.parentId) ?? [];
    list.push(row.id);
    children.set(row.parentId, list);
  }
  return children;
};

const collectSubtree = (rootIds: string[], rows: Array<{ id: string; parentId: string | null }>) => {
  const children = buildChildrenMap(rows);
  const visited = new Set<string>();
  const stack = [...rootIds];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const directChildren = children.get(current) ?? [];
    for (const child of directChildren) {
      stack.push(child);
    }
  }

  return Array.from(visited);
};

const hasAnyRole = (roles: AppRole[], allowed: AppRole[]) =>
  allowed.some((role) => roles.includes(role));

export const resolveManagedUnitIds = async (userId: string, roles: AppRole[]) => {
  if (hasAnyRole(roles, ORG_ADMIN_ROLES)) {
    return null;
  }

  if (!hasAnyRole(roles, SCOPED_MANAGER_ROLES)) {
    return [] as string[];
  }

  const [scopeRows, headedUnitRows, allUnits] = await Promise.all([
    db
      .select({ orgUnitId: userUnitScope.orgUnitId, includeDescendants: userUnitScope.includeDescendants })
      .from(userUnitScope)
      .where(eq(userUnitScope.userId, userId)),
    db
      .select({ id: orgUnit.id })
      .from(orgUnit)
      .innerJoin(staff, eq(staff.id, orgUnit.headStaffId))
      .where(eq(staff.userId, userId)),
    db.select({ id: orgUnit.id, parentId: orgUnit.parentId }).from(orgUnit),
  ]);

  const directScoped = scopeRows
    .filter((row) => !row.includeDescendants)
    .map((row) => row.orgUnitId);
  const descendantRoots = scopeRows
    .filter((row) => row.includeDescendants)
    .map((row) => row.orgUnitId);

  const headedRoots = headedUnitRows.map((row) => row.id);
  const descendants = collectSubtree([...descendantRoots, ...headedRoots], allUnits);
  const merged = new Set<string>([...directScoped, ...descendants]);

  return Array.from(merged);
};

export const filterRowsByManagedUnits = async <
  T extends { orgUnitId: string | null | undefined },
>(
  rows: T[],
  userId: string,
  roles: AppRole[],
) => {
  const managedIds = await resolveManagedUnitIds(userId, roles);
  if (managedIds === null) {
    return rows;
  }

  const allowed = new Set(managedIds);
  return rows.filter((row) => row.orgUnitId && allowed.has(row.orgUnitId));
};

export const applyManagedUnitFilter = async (userId: string, roles: AppRole[]) => {
  const managedIds = await resolveManagedUnitIds(userId, roles);
  if (managedIds === null) {
    return null;
  }

  if (managedIds.length === 0) {
    return [];
  }

  const units = await db.select({ id: orgUnit.id }).from(orgUnit).where(inArray(orgUnit.id, managedIds));
  return units.map((row) => row.id);
};
