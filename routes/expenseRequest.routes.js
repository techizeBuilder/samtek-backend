/** @format */
import { Router } from "express";
import {
  createExpense,
  getMyExpenses,
  updateExpense,
  updateExpenseStatus,
  deleteExpense,
  getTeamExpenseRequests,
  getAllExpenseRequests,
  payExpenseRequest
} from "../controllers/expenseRequestController.js";
import { authMiddleware } from "../middleware/auth.js";
import { expenseUpload } from "../utils/uploadExpense.js";
import { authorizeRoles } from "../middleware/auth.js";
import { checkPermission, checkAnyPermission } from "../middleware/permissions.js";
// Approving and listing other people's requests needs a permission (2026-11-11).
const can = (feature, action) => checkPermission("hrms", feature, action);
const canAny = (features, action) => checkAnyPermission(features.map((f) => ["hrms", f]), action);
const hrOrAccounts = authorizeRoles("HR-Admin", "Hr Admin", "Company Admin", "Superadmin", "Super Admin", "Accounts Head");

const ExpenseRequestRouter = Router();

/* EMPLOYEE */
ExpenseRequestRouter.post(
  "/",
  authMiddleware,
  expenseUpload.single("receipt"),
  createExpense
);

ExpenseRequestRouter.get("/me", authMiddleware, getMyExpenses);
ExpenseRequestRouter.put("/:id", authMiddleware, expenseUpload.single("receipt"), updateExpense);

/* HR / ADMIN */
ExpenseRequestRouter.put("/:id/status", authMiddleware, can("expenseRequests", "edit"), updateExpenseStatus);

ExpenseRequestRouter.delete("/:id", authMiddleware, deleteExpense);

ExpenseRequestRouter.get("/manager", authMiddleware, can("expenseRequests", "view"), getTeamExpenseRequests);
ExpenseRequestRouter.get("/all", authMiddleware, hrOrAccounts, getAllExpenseRequests);
ExpenseRequestRouter.post("/:id/pay", authMiddleware, hrOrAccounts, payExpenseRequest);


export default ExpenseRequestRouter;
