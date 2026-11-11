/** @format */

import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { checkPermission, checkAnyPermission } from "../middleware/permissions.js";
// Approving and listing other people's requests needs a permission (2026-11-11).
const can = (feature, action) => checkPermission("hrms", feature, action);
const canAny = (features, action) => checkAnyPermission(features.map((f) => ["hrms", f]), action);
import {
  applyLeave,
  getMyLeaves,
  updateLeave,
  deleteLeave,
  getTodayTeamLeaves,
  getAllLeaveRequests,
  updateLeaveStatus,
  getAllEmployeesLeaveRequests,
  addLeaveForSomeone
} from "../controllers/leaveController.js";

const LeaveRouter = Router();

LeaveRouter.get("/", authMiddleware, getMyLeaves);
LeaveRouter.post("/", authMiddleware, applyLeave);
LeaveRouter.put("/:id", authMiddleware, updateLeave);
LeaveRouter.delete("/:id", authMiddleware, deleteLeave);
LeaveRouter.get("/manager/today", authMiddleware, can("leaveRequests", "view"), getTodayTeamLeaves);
LeaveRouter.get(
  "/all",
  authMiddleware,
  canAny(["leaveRequests", "payrollRun"], "view"),
  getAllEmployeesLeaveRequests
);
LeaveRouter.get("/manager", authMiddleware, can("leaveRequests", "view"), getAllLeaveRequests);
// HR enters leave for someone, approved at once (2026-11-11).
LeaveRouter.post("/for-someone", authMiddleware, can("leaveRequests", "edit"), addLeaveForSomeone);

LeaveRouter.patch(
  "/manager/leaves/:id/status",
  authMiddleware,
  can("leaveRequests", "edit"),
  updateLeaveStatus
);
export default LeaveRouter;
