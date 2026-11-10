import test from "node:test";
import assert from "node:assert/strict";

import { APP_ROLES, isAppRole } from "../lib/appRoles.js";

test("application roles use the complete canonical lowercase role set", () => {
  assert.deepEqual(APP_ROLES, [
    "super_admin",
    "hospital_admin",
    "hr_manager",
    "payroll_officer",
    "unit_manager",
    "roster_officer",
    "registrar",
    "records_officer",
    "cashier",
    "accounts",
    "billing_officer",
    "doctor",
    "nurse",
    "midwife",
    "pharmacist",
    "pharmacy_tech",
    "lab_scientist",
    "radiographer",
    "radiologist",
    "store_keeper",
    "procurement_officer",
    "report_viewer",
    "auditor",
    "dpo",
    "staff",
  ]);
  assert.equal(new Set(APP_ROLES).size, APP_ROLES.length);
});

test("application role validation rejects legacy aliases and case variants", () => {
  assert.equal(isAppRole("super_admin"), true);
  assert.equal(isAppRole("midwife"), true);
  assert.equal(isAppRole("SUPER_ADMIN"), false);
  assert.equal(isAppRole("admin"), false);
  assert.equal(isAppRole(undefined), false);
});
