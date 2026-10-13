import { Router } from "express";

import auditLogRoutes from "./auditLog.js";
import consentRoutes from "./consent.js";
import facilityRoutes from "./facility.js";
import meRoutes from "./me.js";
import orgUnitRoutes from "./orgUnits.js";
import staffRoutes from "./staff.js";
import usersRoutes from "./users.js";

const router = Router();

router.use("/me", meRoutes);
router.use("/users", usersRoutes);
router.use("/staff", staffRoutes);
router.use("/facility", facilityRoutes);
router.use("/consent", consentRoutes);
router.use("/audit-log", auditLogRoutes);
router.use("/org-units", orgUnitRoutes);

export default router;
