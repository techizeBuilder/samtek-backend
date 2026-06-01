"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExpenseStats = exports.deleteExpense = exports.updateExpense = exports.createExpense = exports.getExpenses = void 0;
const Expense_js_1 = __importDefault(require("../models/Expense.js"));
const schema_js_1 = require("../shared/schema.js");
const getExpenses = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = 1, limit = 10, category, unit, startDate, endDate, search } = req.query;
        const skip = (page - 1) * limit;
        let query = {};
        // Data isolation: Non-Super Admins only see their unit's expenses
        if (req.user.role !== schema_js_1.USER_ROLES.SUPER_USER) {
            query.unit = req.user.unit;
            query.companyId = req.user.companyId;
        }
        else if (unit) {
            query.unit = unit;
        }
        if (category) {
            query.category = category;
        }
        if (startDate || endDate) {
            query.date = {};
            if (startDate)
                query.date.$gte = new Date(startDate);
            if (endDate)
                query.date.$lte = new Date(endDate);
        }
        if (search) {
            query.$or = [
                { expenseType: { $regex: search, $options: 'i' } },
                { notes: { $regex: search, $options: 'i' } }
            ];
        }
        const expenses = yield Expense_js_1.default.find(query)
            .populate('createdBy', 'username fullName')
            .sort({ date: -1, createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        const total = yield Expense_js_1.default.countDocuments(query);
        res.json({
            success: true,
            expenses,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    }
    catch (error) {
        console.error('Get expenses error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
exports.getExpenses = getExpenses;
const createExpense = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { category, expenseType, amount, date, paymentMode, notes, unit, companyId } = req.body;
        const expenseData = {
            category,
            expenseType,
            amount,
            date: date || new Date(),
            paymentMode,
            notes,
            unit: req.user.role === schema_js_1.USER_ROLES.SUPER_USER ? unit : req.user.unit,
            companyId: req.user.role === schema_js_1.USER_ROLES.SUPER_USER ? companyId : req.user.companyId,
            createdBy: req.user._id
        };
        if (!expenseData.unit || !expenseData.companyId) {
            return res.status(400).json({ success: false, message: 'Unit and Company ID are required' });
        }
        const expense = yield Expense_js_1.default.create(expenseData);
        yield expense.populate('createdBy', 'username fullName');
        res.status(201).json({
            success: true,
            message: 'Expense recorded successfully',
            expense
        });
    }
    catch (error) {
        console.error('Create expense error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
exports.createExpense = createExpense;
const updateExpense = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const expense = yield Expense_js_1.default.findById(id);
        if (!expense) {
            return res.status(404).json({ success: false, message: 'Expense not found' });
        }
        // Access control
        if (req.user.role !== schema_js_1.USER_ROLES.SUPER_USER && expense.unit !== req.user.unit) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        const updatedExpense = yield Expense_js_1.default.findByIdAndUpdate(id, Object.assign(Object.assign({}, req.body), { updatedAt: new Date() }), { new: true }).populate('createdBy', 'username fullName');
        res.json({
            success: true,
            message: 'Expense updated successfully',
            expense: updatedExpense
        });
    }
    catch (error) {
        console.error('Update expense error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
exports.updateExpense = updateExpense;
const deleteExpense = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const expense = yield Expense_js_1.default.findById(id);
        if (!expense) {
            return res.status(404).json({ success: false, message: 'Expense not found' });
        }
        // Access control
        if (req.user.role !== schema_js_1.USER_ROLES.SUPER_USER && expense.unit !== req.user.unit) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        yield Expense_js_1.default.findByIdAndDelete(id);
        res.json({ success: true, message: 'Expense deleted successfully' });
    }
    catch (error) {
        console.error('Delete expense error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
exports.deleteExpense = deleteExpense;
const getExpenseStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { unit, startDate, endDate } = req.query;
        let query = {};
        if (req.user.role !== schema_js_1.USER_ROLES.SUPER_USER) {
            query.unit = req.user.unit;
        }
        else if (unit) {
            query.unit = unit;
        }
        if (startDate || endDate) {
            query.date = {};
            if (startDate)
                query.date.$gte = new Date(startDate);
            if (endDate)
                query.date.$lte = new Date(endDate);
        }
        const stats = yield Expense_js_1.default.aggregate([
            { $match: query },
            {
                $group: {
                    _id: '$category',
                    totalAmount: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);
        const totalExpense = stats.reduce((sum, item) => sum + item.totalAmount, 0);
        res.json({
            success: true,
            stats,
            totalExpense
        });
    }
    catch (error) {
        console.error('Get expense stats error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
exports.getExpenseStats = getExpenseStats;
