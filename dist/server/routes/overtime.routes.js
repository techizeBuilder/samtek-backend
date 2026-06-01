"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const overtimeController_js_1 = require("../controllers/overtimeController.js");
const auth_js_1 = require("../middleware/auth.js");
const OvertimeRouter = (0, express_1.Router)();
/* Employee Overtime */
OvertimeRouter.post("/", auth_js_1.authMiddleware, overtimeController_js_1.createOvertime);
OvertimeRouter.get("/me", auth_js_1.authMiddleware, overtimeController_js_1.getMyOvertimeRequests);
OvertimeRouter.get("/team-requests", auth_js_1.authMiddleware, overtimeController_js_1.getTeamOvertimeRequests);
OvertimeRouter.patch("/:id", auth_js_1.authMiddleware, overtimeController_js_1.updateOvertime);
OvertimeRouter.delete("/:id", auth_js_1.authMiddleware, overtimeController_js_1.deleteOvertime);
exports.default = OvertimeRouter;
