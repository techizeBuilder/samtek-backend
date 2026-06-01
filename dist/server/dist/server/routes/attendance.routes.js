"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_js_1 = require("../middleware/auth.js");
const attendanceController_js_1 = require("../controllers/attendanceController.js");
const AttendanceRouter = (0, express_1.Router)();
AttendanceRouter.use(auth_js_1.authMiddleware);
AttendanceRouter.post("/punch-in", attendanceController_js_1.punchIn);
AttendanceRouter.post("/punch-out", attendanceController_js_1.punchOut);
AttendanceRouter.get("/team", attendanceController_js_1.getTeamAttendance);
AttendanceRouter.get("/all", attendanceController_js_1.getAllAttendance);
AttendanceRouter.post("/break/start", attendanceController_js_1.startBreak);
AttendanceRouter.post("/break/end", attendanceController_js_1.endBreak);
AttendanceRouter.get("/me", attendanceController_js_1.getMyAttendance);
exports.default = AttendanceRouter;
