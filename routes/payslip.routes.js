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
import { authMiddleware, authorizeRoles } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const PayslipRouter = Router();

// Who may do what (2026-11-11): the same permissions the screens use, because a
// logged-in user could otherwise call these directly.
const can = (feature, action) => checkPermission("hrms", feature, action);

/* ================= HR / ADMIN ================= */

// Payroll se payslip generate karega (MONTH wise)
PayslipRouter.post(
  "/generate-from-payroll",
  authMiddleware,
  can("payslips", "add"),
  generatePayslipsFromPayroll
);

// HR: sab payslips dekhega
PayslipRouter.get("/", authMiddleware, can("payslips", "view"), getAllPayslips);

// HR: PDF download
PayslipRouter.get("/:id/download", authMiddleware, downloadPayslipPDF);

// HR: Send payslip to employee
PayslipRouter.post("/:id/send", authMiddleware, can("payslips", "edit"), sendPayslipToEmployee);

/* ================= EMPLOYEE ================= */

// Employee: apni payslips dekhega
PayslipRouter.get("/me/my-payslips", authMiddleware, getMyPayslips);
// Wipes every company's payslips, so platform admins only. It had no login check at all.
PayslipRouter.delete("/cleanup", authMiddleware, authorizeRoles("Superadmin", "Super Admin"), deleteAllPayslips);

export default PayslipRouter;
