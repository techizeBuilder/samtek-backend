"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const payslipController_js_1 = require("../controllers/payslipController.js");
const auth_js_1 = require("../middleware/auth.js");
const PayslipRouter = (0, express_1.Router)();
/* ================= HR / ADMIN ================= */
// Payroll se payslip generate karega (MONTH wise)
PayslipRouter.post("/generate-from-payroll", auth_js_1.authMiddleware, payslipController_js_1.generatePayslipsFromPayroll);
// HR: sab payslips dekhega
PayslipRouter.get("/", auth_js_1.authMiddleware, payslipController_js_1.getAllPayslips);
// HR: PDF download
PayslipRouter.get("/:id/download", auth_js_1.authMiddleware, payslipController_js_1.downloadPayslipPDF);
// HR: Send payslip to employee
PayslipRouter.post("/:id/send", auth_js_1.authMiddleware, payslipController_js_1.sendPayslipToEmployee);
/* ================= EMPLOYEE ================= */
// Employee: apni payslips dekhega
PayslipRouter.get("/me/my-payslips", auth_js_1.authMiddleware, payslipController_js_1.getMyPayslips);
PayslipRouter.delete("/cleanup", payslipController_js_1.deleteAllPayslips);
exports.default = PayslipRouter;
