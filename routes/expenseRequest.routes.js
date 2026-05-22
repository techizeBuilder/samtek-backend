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
ExpenseRequestRouter.put("/:id/status", authMiddleware, updateExpenseStatus);

ExpenseRequestRouter.delete("/:id", authMiddleware, deleteExpense);

ExpenseRequestRouter.get("/manager", authMiddleware, getTeamExpenseRequests);
ExpenseRequestRouter.get("/all", authMiddleware, getAllExpenseRequests);
ExpenseRequestRouter.post("/:id/pay", authMiddleware, payExpenseRequest);


export default ExpenseRequestRouter;
