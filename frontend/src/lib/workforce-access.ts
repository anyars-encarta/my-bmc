type WorkforceIdentity = {
  role?: string | null;
  roles?: string[];
};

const HR_ROLES = ["super_admin", "hospital_admin", "hr_manager"] as const;
const READ_ROLES = [
  ...HR_ROLES,
  "payroll_officer",
  "unit_manager",
  "roster_officer",
] as const;

const rolesFor = (identity?: WorkforceIdentity | null) => {
  const roles = new Set(identity?.roles ?? []);
  if (identity?.role) roles.add(identity.role);
  return roles;
};

export const canReadStaffAssignments = (identity?: WorkforceIdentity | null) => {
  const roles = rolesFor(identity);
  return READ_ROLES.some((role) => roles.has(role));
};

export const canWriteStaffAssignments = (identity?: WorkforceIdentity | null) => {
  const roles = rolesFor(identity);
  return HR_ROLES.some((role) => roles.has(role));
};
