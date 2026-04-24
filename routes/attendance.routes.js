/** @format */

import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  punchIn,
  punchOut,
  startBreak,
  endBreak,
  getMyAttendance,
  getTeamAttendance,
  getAllAttendance
} from "../controllers/attendanceController.js";

const AttendanceRouter = Router();

AttendanceRouter.use(authMiddleware);

AttendanceRouter.post("/punch-in", punchIn);
AttendanceRouter.post("/punch-out", punchOut);
AttendanceRouter.get("/team", getTeamAttendance);
AttendanceRouter.get("/all", getAllAttendance);
AttendanceRouter.post("/break/start", startBreak);
AttendanceRouter.post("/break/end", endBreak);

AttendanceRouter.get("/me", getMyAttendance);

export default AttendanceRouter;
