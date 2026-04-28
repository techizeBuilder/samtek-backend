/** @format */

import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
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

AttendanceRequestRouter.use(authMiddleware);

// Employee specific
AttendanceRequestRouter.post("/", createAttendanceRequest);
AttendanceRequestRouter.get("/me", getMyAttendanceRequests);
AttendanceRequestRouter.put("/:id", updateAttendanceRequest);
AttendanceRequestRouter.delete("/:id", deleteAttendanceRequest);

// Manager specific
AttendanceRequestRouter.get("/manager", getTeamAttendanceRequests);
AttendanceRequestRouter.patch("/:id/status", updateAttendanceRequestStatus);

// Admin/HR specific
AttendanceRequestRouter.get("/all", getAllAttendanceRequests);

export default AttendanceRequestRouter;
