"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_js_1 = require("../middleware/auth.js");
const leaveController_js_1 = require("../controllers/leaveController.js");
const LeaveRouter = (0, express_1.Router)();
LeaveRouter.get("/", auth_js_1.authMiddleware, leaveController_js_1.getMyLeaves);
LeaveRouter.post("/", auth_js_1.authMiddleware, leaveController_js_1.applyLeave);
LeaveRouter.put("/:id", auth_js_1.authMiddleware, leaveController_js_1.updateLeave);
LeaveRouter.delete("/:id", auth_js_1.authMiddleware, leaveController_js_1.deleteLeave);
LeaveRouter.get("/manager/today", auth_js_1.authMiddleware, leaveController_js_1.getTodayTeamLeaves);
LeaveRouter.get("/all", auth_js_1.authMiddleware, leaveController_js_1.getAllEmployeesLeaveRequests);
LeaveRouter.get("/manager", auth_js_1.authMiddleware, leaveController_js_1.getAllLeaveRequests);
LeaveRouter.patch("/manager/leaves/:id/status", auth_js_1.authMiddleware, leaveController_js_1.updateLeaveStatus);
exports.default = LeaveRouter;
