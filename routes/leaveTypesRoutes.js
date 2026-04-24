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

const LeaveTypeRouter = Router();

LeaveTypeRouter.post("/", authMiddleware, addLeaveType);
LeaveTypeRouter.get("/", authMiddleware, getAllLeaveTypes);
LeaveTypeRouter.get("/:id", authMiddleware, getLeaveTypeById);
LeaveTypeRouter.put("/:id", authMiddleware, updateLeaveType);
LeaveTypeRouter.delete("/:id", authMiddleware, deleteLeaveTypeById);

export default LeaveTypeRouter;
