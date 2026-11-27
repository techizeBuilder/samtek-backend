/** @format */
import { Router } from "express";
import { authMiddleware, authorizeRoles } from "../middleware/auth.js";
import { getAttendancePolicy, updateAttendancePolicy } from "../controllers/attendancePolicyController.js";
import { hrRoleSwitch } from "../middleware/permissions.js"; // security re-check M5 (27 Nov 2026): on the HR Policy page

const attendancePolicyRouter = Router();
attendancePolicyRouter.use(authMiddleware);

attendancePolicyRouter.get("/", getAttendancePolicy);
attendancePolicyRouter.put("/", authorizeRoles("HR-Admin", "Hr Admin", "Company Admin", "Superadmin", "Super Admin"), hrRoleSwitch("hrPolicy", "edit"), updateAttendancePolicy);

export default attendancePolicyRouter;
