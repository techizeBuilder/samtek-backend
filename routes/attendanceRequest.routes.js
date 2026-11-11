/** @format */

import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { checkAnyPermission } from "../middleware/permissions.js";
import {
  createAttendanceRequest,
  getMyAttendanceRequests,
  updateAttendanceRequest,
  deleteAttendanceRequest,
  getTeamAttendanceRequests,
  updateAttendanceRequestStatus,
  getAllAttendanceRequests,
} from "../controllers/attendanceRequestController.js";

const AttendanceRequestRouter = Router();

// Approving and listing other people's requests needs a permission (2026-11-11).
const canAny = (features, action) => checkAnyPermission(features.map((f) => ["hrms", f]), action);

AttendanceRequestRouter.use(authMiddleware);

// Employee specific
AttendanceRequestRouter.post("/", createAttendanceRequest);
AttendanceRequestRouter.get("/me", getMyAttendanceRequests);
AttendanceRequestRouter.put("/:id", updateAttendanceRequest);
AttendanceRequestRouter.delete("/:id", deleteAttendanceRequest);

// Manager specific
AttendanceRequestRouter.get("/manager", canAny(["attendanceCorrections"], "view"), getTeamAttendanceRequests);
AttendanceRequestRouter.patch("/:id/status", canAny(["attendanceCorrections", "attendanceRequests"], "edit"), updateAttendanceRequestStatus);

// Admin/HR specific
AttendanceRequestRouter.get("/all", canAny(["attendanceRequests"], "view"), getAllAttendanceRequests);

export default AttendanceRequestRouter;
