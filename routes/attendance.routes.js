/** @format */

import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { checkAnyPermission } from "../middleware/permissions.js";
import {
  punchIn,
  punchOut,
  startBreak,
  endBreak,
  getMyAttendance,
  getTeamAttendance,
  getAllAttendance,
  getSelfMark,
  refuseIfOnDevice
} from "../controllers/attendanceController.js";

const AttendanceRouter = Router();

// Other people's attendance needs a permission (2026-11-11). /me and punching are
// a person's own.
const canAny = (features) => checkAnyPermission(features.map((f) => ["hrms", f]), "view");

AttendanceRouter.use(authMiddleware);

AttendanceRouter.get("/self-mark", getSelfMark);
AttendanceRouter.post("/punch-in", refuseIfOnDevice, punchIn);
AttendanceRouter.post("/punch-out", refuseIfOnDevice, punchOut);
AttendanceRouter.get("/team", canAny(["teamAttendance"]), getTeamAttendance);
AttendanceRouter.get("/all", canAny(["attendanceRecord", "teamAttendance", "payrollRun"]), getAllAttendance);
AttendanceRouter.post("/break/start", refuseIfOnDevice, startBreak);
AttendanceRouter.post("/break/end", refuseIfOnDevice, endBreak);

AttendanceRouter.get("/me", getMyAttendance);

export default AttendanceRouter;
