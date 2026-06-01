"use strict";
/** @format */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.payExpenseRequest = exports.getAllExpenseRequests = exports.deleteExpense = exports.updateExpense = exports.updateExpenseStatus = exports.getTeamExpenseRequests = exports.getMyExpenses = exports.createExpense = void 0;
const ExpenseRequest_js_1 = __importDefault(require("../models/ExpenseRequest.js"));
const User_js_1 = __importDefault(require("../models/User.js"));
/* ================= EMPLOYEE: CREATE EXPENSE ================= */
const createExpense = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { expenseType, subCategory, billingType, travelRequestId, amount, date, remarks } = req.body;
        const expense = yield ExpenseRequest_js_1.default.create({
            employee: req.user._id,
            expenseType,
            subCategory,
            billingType,
            travelRequestId: expenseType === "Travel Expense" ? travelRequestId : undefined,
            amount,
            date,
            remarks,
            receipt: req.file ? `/uploads/expenses/${req.file.filename}` : undefined,
            status: "PENDING",
        });
        res.status(201).json(expense);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to submit expense" });
    }
});
exports.createExpense = createExpense;
/* ================= EMPLOYEE: MY EXPENSES ================= */
const getMyExpenses = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const expenses = yield ExpenseRequest_js_1.default.find({
            employee: req.user._id,
        }).sort({ createdAt: -1 });
        res.json(expenses);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to fetch expenses" });
    }
});
exports.getMyExpenses = getMyExpenses;
/* ================= MANAGER: TEAM EXPENSE REQUESTS ================= */
const getTeamExpenseRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const managerId = req.user._id;
        // 🔹 manager ke under employees
        const teamEmployees = yield User_js_1.default.find({ reportingManager: managerId }, "_id fullName username email");
        const employeeIds = teamEmployees.map((e) => e._id);
        // 🔹 unhi employees ke expenses
        const fetchedExpenses = yield ExpenseRequest_js_1.default.find({
            employee: { $in: employeeIds },
        })
            .populate("employee", "fullName username email")
            .sort({ createdAt: -1 })
            .lean();
        const expenses = fetchedExpenses.map(e => {
            if (e.employee) {
                e.employee.name = e.employee.fullName || e.employee.username || 'Unknown';
            }
            return e;
        });
        res.status(200).json(expenses);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to fetch expense requests",
        });
    }
});
exports.getTeamExpenseRequests = getTeamExpenseRequests;
/* ================= MANAGER: UPDATE STATUS ================= */
const updateExpenseStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status } = req.body;
        if (!["APPROVED", "REJECTED", "PAID"].includes(status)) {
            return res.status(400).json({ message: "Invalid status" });
        }
        const expense = yield ExpenseRequest_js_1.default.findById(req.params.id);
        if (!expense) {
            return res.status(404).json({ message: "Expense not found" });
        }
        expense.status = status;
        yield expense.save();
        res.json(expense);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update expense status" });
    }
});
exports.updateExpenseStatus = updateExpenseStatus;
/* ================= EMPLOYEE: UPDATE (ONLY PENDING) ================= */
const updateExpense = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { expenseType, subCategory, billingType, travelRequestId, amount, date, remarks } = req.body;
        const expense = yield ExpenseRequest_js_1.default.findOne({
            _id: req.params.id,
            employee: req.user._id,
            status: "PENDING"
        });
        if (!expense) {
            return res.status(404).json({ message: "Expense request not found or already processed" });
        }
        expense.expenseType = expenseType || expense.expenseType;
        expense.subCategory = subCategory || expense.subCategory;
        expense.billingType = billingType || expense.billingType;
        expense.travelRequestId = expenseType === "Travel Expense" ? travelRequestId : expense.travelRequestId;
        expense.amount = amount || expense.amount;
        expense.date = date || expense.date;
        expense.remarks = remarks || expense.remarks;
        if (req.file) {
            expense.receipt = `/uploads/expenses/${req.file.filename}`;
        }
        yield expense.save();
        res.json({ message: "Expense updated successfully", expense });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to update expense" });
    }
});
exports.updateExpense = updateExpense;
/* ================= EMPLOYEE: DELETE (ONLY PENDING) ================= */
const deleteExpense = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const expense = yield ExpenseRequest_js_1.default.findOneAndDelete({
        _id: req.params.id,
        employee: req.user._id,
        status: "PENDING",
    });
    if (!expense) {
        return res.status(404).json({
            message: "Expense not found or can't be deleted",
        });
    }
    res.json({ message: "Expense deleted successfully" });
});
exports.deleteExpense = deleteExpense;
/* ================= ADMIN / FINANCE: ALL EXPENSE REQUESTS ================= */
const getAllExpenseRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const fetchedExpenses = yield ExpenseRequest_js_1.default.find()
            .populate("employee", "fullName username email employeeId")
            .sort({ createdAt: -1 })
            .lean();
        const expenses = fetchedExpenses.map(e => {
            if (e.employee) {
                e.employee.name = e.employee.fullName || e.employee.username || 'Unknown';
            }
            return e;
        });
        res.status(200).json(expenses);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to fetch all expense requests",
        });
    }
});
exports.getAllExpenseRequests = getAllExpenseRequests;
/* ================= ADMIN / FINANCE: PAY EXPENSE REQUEST ================= */
const payExpenseRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { paymentMode, notes } = req.body;
        const expenseRequestId = req.params.id;
        const expenseRequest = yield ExpenseRequest_js_1.default.findById(expenseRequestId).populate("employee");
        if (!expenseRequest) {
            return res.status(404).json({ message: "Expense request not found" });
        }
        if (expenseRequest.status === "PAID") {
            return res.status(400).json({ message: "Expense already paid" });
        }
        const { Transaction, Account } = yield Promise.resolve().then(() => __importStar(require("../models/Account.js")));
        const RealExpense = (yield Promise.resolve().then(() => __importStar(require("../models/Expense.js")))).default;
        const employee = expenseRequest.employee;
        const unit = req.user.unit || employee.unit;
        const companyId = req.user.companyId || employee.companyId;
        // 1. Create Real Expense Record
        const realExpense = yield RealExpense.create({
            companyId,
            unit,
            category: 'Operational', // Default for employee requests
            expenseType: expenseRequest.expenseType,
            amount: expenseRequest.amount,
            date: new Date(),
            paymentMode: paymentMode || 'Cash',
            notes: notes || expenseRequest.remarks,
            createdBy: req.user._id
        });
        // 2. Journal Entry Posting
        // Debit: Expense Account
        // Credit: Cash/Bank Account
        const expenseAccount = yield Account.findOne({ accountName: 'Indirect Expenses', unit });
        const paymentAccount = yield Account.findOne({ accountName: paymentMode === 'Bank Transfer' ? 'Bank Account' : 'Cash Account', unit });
        if (expenseAccount && paymentAccount) {
            const txn = new Transaction({
                transactionNumber: `TXN-EXP-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                description: `Expense Paid: ${expenseRequest.expenseType} for ${employee.name}`,
                reference: realExpense._id.toString(),
                totalAmount: expenseRequest.amount,
                unit,
                relatedDocument: 'Expense',
                relatedDocumentId: realExpense._id,
                createdBy: req.user._id,
                entries: [
                    { account: expenseAccount._id, debit: expenseRequest.amount, credit: 0 },
                    { account: paymentAccount._id, debit: 0, credit: expenseRequest.amount }
                ]
            });
            yield txn.save();
            // Update account balances
            expenseAccount.balance += expenseRequest.amount;
            paymentAccount.balance -= expenseRequest.amount;
            yield expenseAccount.save();
            yield paymentAccount.save();
        }
        // 3. Update Request Status
        expenseRequest.status = "PAID";
        yield expenseRequest.save();
        res.json({ success: true, message: "Expense paid and recorded in ledger", data: realExpense });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to process payment: " + error.message });
    }
});
exports.payExpenseRequest = payExpenseRequest;
