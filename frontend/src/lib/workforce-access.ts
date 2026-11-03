type WorkforceIdentity = {
  role?: string | null;
  roles?: string[];
};

const HR_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"] as const;
const READ_ROLES = [
  ...HR_ROLES,
  "PAYROLL_OFFICER",
  "UNIT_MANAGER",
  "ROSTER_OFFICER",
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
