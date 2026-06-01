"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/** @format */
const express_1 = require("express");
const expenseRequestController_js_1 = require("../controllers/expenseRequestController.js");
const auth_js_1 = require("../middleware/auth.js");
const uploadExpense_js_1 = require("../utils/uploadExpense.js");
const ExpenseRequestRouter = (0, express_1.Router)();
/* EMPLOYEE */
ExpenseRequestRouter.post("/", auth_js_1.authMiddleware, uploadExpense_js_1.expenseUpload.single("receipt"), expenseRequestController_js_1.createExpense);
ExpenseRequestRouter.get("/me", auth_js_1.authMiddleware, expenseRequestController_js_1.getMyExpenses);
ExpenseRequestRouter.put("/:id", auth_js_1.authMiddleware, uploadExpense_js_1.expenseUpload.single("receipt"), expenseRequestController_js_1.updateExpense);
/* HR / ADMIN */
ExpenseRequestRouter.put("/:id/status", auth_js_1.authMiddleware, expenseRequestController_js_1.updateExpenseStatus);
ExpenseRequestRouter.delete("/:id", auth_js_1.authMiddleware, expenseRequestController_js_1.deleteExpense);
ExpenseRequestRouter.get("/manager", auth_js_1.authMiddleware, expenseRequestController_js_1.getTeamExpenseRequests);
ExpenseRequestRouter.get("/all", auth_js_1.authMiddleware, expenseRequestController_js_1.getAllExpenseRequests);
ExpenseRequestRouter.post("/:id/pay", auth_js_1.authMiddleware, expenseRequestController_js_1.payExpenseRequest);
exports.default = ExpenseRequestRouter;
