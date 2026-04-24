/** @format */

import { Router } from "express";
import {
  getPayrollByMonth,
  savePayroll,
  updatePayrollStatus,
  resetPayrollByMonth,
  rejectPayroll,
  recalculatePayroll
} from "../controllers/payrollController.js";
import { authMiddleware } from "../middleware/auth.js";

const PayrollRouter = Router();

/* HR / FINANCE */
PayrollRouter.get("/", authMiddleware, getPayrollByMonth);
PayrollRouter.post("/run", authMiddleware, savePayroll);
PayrollRouter.patch("/:id/status", authMiddleware, updatePayrollStatus);
PayrollRouter.delete("/reset", resetPayrollByMonth);
PayrollRouter.patch("/:id/reject",rejectPayroll);
PayrollRouter.post("/recalculate",recalculatePayroll);

export default PayrollRouter;
