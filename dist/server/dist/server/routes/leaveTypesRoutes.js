"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const leaveTypeController_js_1 = require("../controllers/leaveTypeController.js");
const auth_js_1 = require("../middleware/auth.js");
const LeaveTypeRouter = (0, express_1.Router)();
LeaveTypeRouter.post("/", auth_js_1.authMiddleware, leaveTypeController_js_1.addLeaveType);
LeaveTypeRouter.get("/", auth_js_1.authMiddleware, leaveTypeController_js_1.getAllLeaveTypes);
LeaveTypeRouter.get("/:id", auth_js_1.authMiddleware, leaveTypeController_js_1.getLeaveTypeById);
LeaveTypeRouter.put("/:id", auth_js_1.authMiddleware, leaveTypeController_js_1.updateLeaveType);
LeaveTypeRouter.delete("/:id", auth_js_1.authMiddleware, leaveTypeController_js_1.deleteLeaveTypeById);
exports.default = LeaveTypeRouter;
