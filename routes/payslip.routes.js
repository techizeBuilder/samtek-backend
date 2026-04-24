/** @format */

import { Router } from "express";
import {
  generatePayslipsFromPayroll,
  getAllPayslips,
  downloadPayslipPDF,
  sendPayslipToEmployee,
  getMyPayslips,
  deleteAllPayslips,
} from "../controllers/payslipController.js";
import { authMiddleware } from "../middleware/auth.js";

const PayslipRouter = Router();

/* ================= HR / ADMIN ================= */

// Payroll se payslip generate karega (MONTH wise)
PayslipRouter.post(
  "/generate-from-payroll",
  authMiddleware,
  generatePayslipsFromPayroll
);

// HR: sab payslips dekhega
PayslipRouter.get("/", authMiddleware, getAllPayslips);

// HR: PDF download
PayslipRouter.get("/:id/download", authMiddleware, downloadPayslipPDF);

// HR: Send payslip to employee
PayslipRouter.post("/:id/send", authMiddleware, sendPayslipToEmployee);

/* ================= EMPLOYEE ================= */

// Employee: apni payslips dekhega
PayslipRouter.get("/me/my-payslips", authMiddleware, getMyPayslips);
PayslipRouter.delete("/cleanup",deleteAllPayslips);

export default PayslipRouter;
