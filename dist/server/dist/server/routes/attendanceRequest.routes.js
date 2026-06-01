"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_js_1 = require("../middleware/auth.js");
const attendanceRequestController_js_1 = require("../controllers/attendanceRequestController.js");
const AttendanceRequestRouter = (0, express_1.Router)();
AttendanceRequestRouter.use(auth_js_1.authMiddleware);
// Employee specific
AttendanceRequestRouter.post("/", attendanceRequestController_js_1.createAttendanceRequest);
AttendanceRequestRouter.get("/me", attendanceRequestController_js_1.getMyAttendanceRequests);
AttendanceRequestRouter.put("/:id", attendanceRequestController_js_1.updateAttendanceRequest);
AttendanceRequestRouter.delete("/:id", attendanceRequestController_js_1.deleteAttendanceRequest);
// Manager specific
AttendanceRequestRouter.get("/manager", attendanceRequestController_js_1.getTeamAttendanceRequests);
AttendanceRequestRouter.patch("/:id/status", attendanceRequestController_js_1.updateAttendanceRequestStatus);
// Admin/HR specific
AttendanceRequestRouter.get("/all", attendanceRequestController_js_1.getAllAttendanceRequests);
exports.default = AttendanceRequestRouter;
