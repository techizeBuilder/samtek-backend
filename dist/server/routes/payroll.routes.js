"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const payrollController_js_1 = require("../controllers/payrollController.js");
const auth_js_1 = require("../middleware/auth.js");
const PayrollRouter = (0, express_1.Router)();
/* HR / FINANCE */
PayrollRouter.get("/", auth_js_1.authMiddleware, payrollController_js_1.getPayrollByMonth);
PayrollRouter.post("/run", auth_js_1.authMiddleware, payrollController_js_1.savePayroll);
PayrollRouter.patch("/:id/status", auth_js_1.authMiddleware, payrollController_js_1.updatePayrollStatus);
PayrollRouter.delete("/reset", payrollController_js_1.resetPayrollByMonth);
PayrollRouter.patch("/:id/reject", payrollController_js_1.rejectPayroll);
PayrollRouter.post("/recalculate", payrollController_js_1.recalculatePayroll);
exports.default = PayrollRouter;
