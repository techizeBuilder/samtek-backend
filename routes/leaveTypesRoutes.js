/** @format */

import { Router } from "express";
import {
  addLeaveType,
  getAllLeaveTypes,
  getLeaveTypeById,
  updateLeaveType,
  deleteLeaveTypeById,
} from "../controllers/leaveTypeController.js";
import { authMiddleware } from "../middleware/auth.js";
import { checkPermission, checkAnyPermission } from "../middleware/permissions.js";
// Approving and listing other people's requests needs a permission (2026-11-11).
const can = (feature, action) => checkPermission("hrms", feature, action);
const canAny = (features, action) => checkAnyPermission(features.map((f) => ["hrms", f]), action);

const LeaveTypeRouter = Router();

LeaveTypeRouter.post("/", authMiddleware, can("leaveTypes", "add"), addLeaveType);
LeaveTypeRouter.get("/", authMiddleware, getAllLeaveTypes);
LeaveTypeRouter.get("/:id", authMiddleware, getLeaveTypeById);
LeaveTypeRouter.put("/:id", authMiddleware, can("leaveTypes", "edit"), updateLeaveType);
LeaveTypeRouter.delete("/:id", authMiddleware, can("leaveTypes", "delete"), deleteLeaveTypeById);

export default LeaveTypeRouter;
