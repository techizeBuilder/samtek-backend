"use strict";
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
exports.getFinanceSummary = void 0;
const Sale_js_1 = __importDefault(require("../models/Sale.js"));
const Return_js_1 = __importDefault(require("../models/Return.js"));
const Expense_js_1 = __importDefault(require("../models/Expense.js"));
const Partner_js_1 = require("../models/Partner.js");
const mongoose_1 = __importDefault(require("mongoose"));
const schema_js_1 = require("../shared/schema.js");
const getFinanceSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { unit, startDate, endDate, period = 'month' } = req.query;
        let query = {};
        // If user is Super Admin or Accountant, allow viewing consolidated summary (all units)
        // unless a specific unit filter is provided in the query.
        if (req.user.role === schema_js_1.USER_ROLES.SUPER_ADMIN || req.user.role === schema_js_1.USER_ROLES.SUPER_USER || req.user.role === 'Accounts') {
            if (unit) {
                query.unit = unit;
            }
            // If no unit provided, query stays empty {} which means "All Units"
        }
        else {
            // For other roles (like Unit Head), restrict to their own unit
            if (req.user.unit)
                query.unit = req.user.unit;
            if (req.user.companyId)
                query.companyId = new mongoose_1.default.Types.ObjectId(req.user.companyId);
        }
        // Date range logic
        let start = startDate ? new Date(startDate) : null;
        let end = endDate ? new Date(endDate) : new Date();
        if (!start) {
            const now = new Date();
            if (period === 'week') {
                start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            }
            else if (period === 'month') {
                start = new Date(now.getFullYear(), now.getMonth(), 1);
            }
            else if (period === 'year') {
                start = new Date(now.getFullYear(), 0, 1);
            }
            else {
                start = new Date(now.getFullYear(), now.getMonth(), 1);
            }
        }
        // Ensure start is at beginning of day and end is at end of day
        start.setHours(0, 0, 0, 0);
        let finalEnd = end ? new Date(end) : new Date();
        finalEnd.setHours(23, 59, 59, 999);
        const dateQuery = { $gte: start, $lte: finalEnd };
        // Aggregate Sales (Revenue)
        // In Sale.js, it's 'saleDate' or 'createdAt'
        const salesPromise = Sale_js_1.default.aggregate([
            {
                $match: Object.assign(Object.assign({}, query), { saleDate: dateQuery })
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$totalAmount' }
                }
            }
        ]);
        // Aggregate Returns (Reduced Revenue)
        // In Return.js, it's 'returnDate'
        const returnsPromise = Return_js_1.default.aggregate([
            {
                $match: Object.assign(Object.assign({}, query), { returnDate: dateQuery, status: 'approved' })
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$totalAmount' }
                }
            }
        ]);
        // Aggregate Expenses
        const expensesPromise = Expense_js_1.default.aggregate([
            {
                $match: Object.assign(Object.assign({}, query), { date: dateQuery })
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' }
                }
            }
        ]);
        const partnersPromise = Partner_js_1.Partner.find({ companyId: req.user.companyId, isActive: true }).lean();
        const [salesResult, returnsResult, expensesResult, partners] = yield Promise.all([
            salesPromise,
            returnsPromise,
            expensesPromise,
            partnersPromise
        ]);
        const totalSales = ((_a = salesResult[0]) === null || _a === void 0 ? void 0 : _a.total) || 0;
        const totalReturns = ((_b = returnsResult[0]) === null || _b === void 0 ? void 0 : _b.total) || 0;
        const netSales = totalSales - totalReturns;
        const totalExpenses = ((_c = expensesResult[0]) === null || _c === void 0 ? void 0 : _c.total) || 0;
        const netProfit = netSales - totalExpenses;
        res.json({
            success: true,
            summary: {
                totalSales,
                totalReturns,
                netSales,
                totalExpenses,
                netProfit,
                period: {
                    start,
                    end: finalEnd
                },
                partners: partners || []
            }
        });
    }
    catch (error) {
        console.error('Get finance summary error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
exports.getFinanceSummary = getFinanceSummary;
