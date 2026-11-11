/** @format */

import { Router } from "express";
import {
  getPayrollByMonth,
  getPayrollMonth,
  getPayrollDays,
  savePayroll,
  updatePayrollStatus,
  resetPayrollByMonth,
  rejectPayroll,
  recalculatePayroll
} from "../controllers/payrollController.js";
import { authMiddleware } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const PayrollRouter = Router();

// Who may do what (2026-11-11): the same permissions the screens use, because a
// logged-in user could otherwise call these directly.
const can = (feature, action) => checkPermission("hrms", feature, action);

/* HR / FINANCE */
PayrollRouter.get("/", authMiddleware, can("payrollRun", "view"), getPayrollByMonth);
PayrollRouter.get("/month", authMiddleware, can("payrollRun", "view"), getPayrollMonth);
PayrollRouter.get("/days", authMiddleware, can("payrollRun", "view"), getPayrollDays);
PayrollRouter.post("/run", authMiddleware, can("payrollRun", "add"), savePayroll);
PayrollRouter.patch("/:id/status", authMiddleware, can("payrollRun", "edit"), updatePayrollStatus);
PayrollRouter.delete("/reset", authMiddleware, can("payrollRun", "delete"), resetPayrollByMonth);
PayrollRouter.patch("/:id/reject", authMiddleware, can("payrollRun", "edit"), rejectPayroll);
PayrollRouter.post("/recalculate", authMiddleware, can("payrollRun", "edit"), recalculatePayroll);

export default PayrollRouter;
