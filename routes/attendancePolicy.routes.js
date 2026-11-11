/** @format */
import { Router } from "express";
import { authMiddleware, authorizeRoles } from "../middleware/auth.js";
import { getAttendancePolicy, updateAttendancePolicy } from "../controllers/attendancePolicyController.js";

const attendancePolicyRouter = Router();
attendancePolicyRouter.use(authMiddleware);

attendancePolicyRouter.get("/", getAttendancePolicy);
attendancePolicyRouter.put("/", authorizeRoles("HR-Admin", "Hr Admin", "Company Admin", "Superadmin", "Super Admin"), updateAttendancePolicy);

export default attendancePolicyRouter;
