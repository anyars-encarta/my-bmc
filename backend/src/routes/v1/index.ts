import { Router } from "express";

import auditLogRoutes from "./auditLog.js";
import assignmentRoutes from "./assignments.js";
import attendanceRoutes from "./attendance.js";
import attendanceOperationsRoutes from "./attendanceOperations.js";
import consentRoutes from "./consent.js";
import facilityRoutes from "./facility.js";
import jobRoleRoutes from "./jobRoles.js";
import meRoutes from "./me.js";
import orgUnitRoutes from "./orgUnits.js";
import rosterRoutes from "./rosters.js";
import shiftTypeRoutes from "./shiftTypes.js";
import staffRoutes from "./staff.js";
import usersRoutes from "./users.js";

const router = Router();

router.use("/me", meRoutes);
router.use("/users", usersRoutes);
router.use("/", attendanceOperationsRoutes);
router.use("/staff", staffRoutes);
router.use("/", attendanceRoutes);
router.use("/shift-types", shiftTypeRoutes);
router.use("/", rosterRoutes);
router.use("/job-roles", jobRoleRoutes);
router.use("/facility", facilityRoutes);
router.use("/consent", consentRoutes);
router.use("/audit-log", auditLogRoutes);
router.use("/org-units", orgUnitRoutes);
router.use("/", assignmentRoutes);

export default router;
