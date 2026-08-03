import Sale from '../models/Sale.js';
import Return from '../models/Return.js';
import Expense from '../models/Expense.js';
import { Partner } from '../models/Partner.js';
import OrderForm from '../models/OrderForm.js';
import mongoose from 'mongoose';
import { USER_ROLES } from '../shared/schema.js';
import MarketingExpense from '../models/MarketingExpense.js';
import PackagingDispatchExpense from '../models/PackagingDispatchExpense.js';
import PurchaseExpense from '../models/PurchaseExpense.js';
import HrExpense from '../models/HrExpense.js';
import ProductionExpense from '../models/ProductionExpense.js';
import RDExpense from '../models/RDExpense.js';
import ComplaintExpense from '../models/ComplaintExpense.js';
import TenderExpense from '../models/TenderExpense.js';

// Every NEW department expense module rolled into the Financial Summary's
// "Total Expenses" / Net Profit calculation, on top of the pre-existing
// generic Accounts "Expense" model (which is aggregated separately below
// via `expensesPromise`, since it alone carries a `unit` field to scope by).
// These 8 only carry `companyId` (no `unit`), so they're matched on
// companyId alone — see deptExpenseQuery, mirrored from the kacchaQuery
// pattern already used for the Kaccha revenue aggregate.
const DEPARTMENT_EXPENSE_MODELS = [
  { key: 'marketing', label: 'Marketing Expenses', model: MarketingExpense },
  { key: 'packagingDispatch', label: 'Packing & Dispatch Expenses', model: PackagingDispatchExpense },
  { key: 'purchase', label: 'Purchase Expenses', model: PurchaseExpense },
  { key: 'hr', label: 'HR Expenses', model: HrExpense },
  { key: 'production', label: 'Production Expenses', model: ProductionExpense },
  { key: 'rd', label: 'R&D Expenses', model: RDExpense },
  { key: 'complaint', label: 'Service & Complaint Expenses', model: ComplaintExpense },
  { key: 'tender', label: 'Tender Expenses', model: TenderExpense },
];

export const getFinanceSummary = async (req, res) => {
    try {
        const { unit, startDate, endDate, period = 'month' } = req.query;

        let query = {};
        // Only true platform-level roles get a cross-company "All Units" view.
        // 'Accounts' is a normal per-company role — it used to be bundled in
        // with Super Admin here, which meant an Accounts user could see every
        // company's Sale/Return/Expense data (and everything derived from
        // `query` below: kacchaQuery, deptExpenseQuery) by picking a unit with
        // no companyId restriction at all, or see ALL companies if they left
        // unit blank. Sale/Return/Expense all carry a `companyId` field, so
        // this is a fixable scoping gap, not a "no such field" situation.
        if (req.user.role === USER_ROLES.SUPER_ADMIN || req.user.role === USER_ROLES.SUPER_USER) {
            if (unit) {
                query.unit = unit;
            }
            // If no unit provided, query stays empty {} which means "All Units"
        } else {
            // For other roles (Accounts, Unit Head, etc.), restrict to their own company
            if (req.user.unit) query.unit = req.user.unit;
            if (req.user.companyId) query.companyId = new mongoose.Types.ObjectId(req.user.companyId);
        }

        // Date range logic
        let start = startDate ? new Date(startDate) : null;
        let end = endDate ? new Date(endDate) : new Date();

        if (!start) {
            const now = new Date();
            if (period === 'week') {
                start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            } else if (period === 'month') {
                start = new Date(now.getFullYear(), now.getMonth(), 1);
            } else if (period === 'year') {
                start = new Date(now.getFullYear(), 0, 1);
            } else {
                start = new Date(now.getFullYear(), now.getMonth(), 1);
            }
        }

        // Ensure start is at beginning of day and end is at end of day
        start.setHours(0, 0, 0, 0);
        let finalEnd = end ? new Date(end) : new Date();
        finalEnd.setHours(23, 59, 59, 999);

        const dateQuery = { $gte: start, $lte: finalEnd };

        // Aggregate Sales (Revenue) — Pakka (formal/GST) invoices only.
        // The Financial Summary's default profit figure must reflect the
        // company's official billed book, not the informal/Kachha side.
        // In Sale.js, it's 'saleDate' or 'createdAt'
        const salesPromise = Sale.aggregate([
            {
                $match: {
                    ...query,
                    saleDate: dateQuery,
                    invoiceType: 'Pakka'
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$totalAmount' }
                }
            }
        ]);

        // Aggregate Kachha (cash/informal) revenue from the Sales Order Form —
        // Billing Amount + GST Amount + Cash Amount, exactly as recorded by
        // Accounts when the deal was billed. Used only for the double-click
        // "flip" on the Financial Summary profit figure.
        const kacchaQuery = {};
        if (query.companyId) kacchaQuery.companyId = query.companyId;
        const kacchaPromise = OrderForm.aggregate([
            {
                $match: {
                    ...kacchaQuery,
                    status: 'Submitted',
                    createdAt: dateQuery
                }
            },
            {
                $group: {
                    _id: null,
                    billAmount: { $sum: '$totals.billAmount' },
                    gstAmount: { $sum: '$totals.gstAmount' },
                    cashAmount: { $sum: '$totals.cashAmount' }
                }
            }
        ]);

        // Aggregate Returns (Reduced Revenue)
        // In Return.js, it's 'returnDate'
        const returnsPromise = Return.aggregate([
            {
                $match: {
                    ...query,
                    returnDate: dateQuery,
                    status: 'approved'
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$totalAmount' }
                }
            }
        ]);

        // Aggregate Expenses — legacy Accounts "Daily Expenses" (has a `unit`
        // field, so it's scoped by the same `query` used for Sales/Returns).
        const expensesPromise = Expense.aggregate([
            {
                $match: {
                    ...query,
                    date: dateQuery
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);

        // Aggregate every department-specific expense module (Marketing,
        // Packing & Dispatch, Purchase, HR, Production, R&D, Service &
        // Complaint, Tender) for the same date range. None of these carry a
        // `unit` field, so scope by companyId only — same pattern as kacchaQuery.
        const deptExpenseQuery = {};
        if (query.companyId) deptExpenseQuery.companyId = query.companyId;

        const deptExpensePromises = DEPARTMENT_EXPENSE_MODELS.map(({ model }) =>
            model.aggregate([
                { $match: { ...deptExpenseQuery, date: dateQuery } },
                { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
            ])
        );

        const partnersPromise = Partner.find({ companyId: req.user.companyId, isActive: true }).lean();

        const [salesResult, returnsResult, expensesResult, kacchaResult, partners, ...deptExpenseResults] = await Promise.all([
            salesPromise,
            returnsPromise,
            expensesPromise,
            kacchaPromise,
            partnersPromise,
            ...deptExpensePromises
        ]);

        const totalSales = salesResult[0]?.total || 0;
        const totalReturns = returnsResult[0]?.total || 0;
        const netSales = totalSales - totalReturns;

        // Legacy Accounts "Daily Expenses" total
        const accountsExpenseTotal = expensesResult[0]?.total || 0;
        const accountsExpenseCount = expensesResult[0]?.count || 0;

        // Department-wise breakdown, sorted highest-spend first — this is
        // what "Show Expenses" renders on the Financial Summary page.
        const expensesByDepartment = [
            { key: 'accounts', label: 'Accounts — Daily Expenses', total: accountsExpenseTotal, count: accountsExpenseCount },
            ...DEPARTMENT_EXPENSE_MODELS.map(({ key, label }, idx) => ({
                key,
                label,
                total: deptExpenseResults[idx][0]?.total || 0,
                count: deptExpenseResults[idx][0]?.count || 0,
            })),
        ].sort((a, b) => b.total - a.total);

        // Total Expenses now reflects EVERY department's logged expenses,
        // not just the old generic Accounts "Daily Expenses" entries.
        const totalExpenses = expensesByDepartment.reduce((sum, d) => sum + d.total, 0);
        const netProfit = netSales - totalExpenses;

        // Kaccha (cash-side) profit: Billing Amount + GST Amount + Cash Amount
        // from the Sales Order Form, minus the same shared returns/expenses.
        const kacchaBillAmount = kacchaResult[0]?.billAmount || 0;
        const kacchaGstAmount = kacchaResult[0]?.gstAmount || 0;
        const kacchaCashAmount = kacchaResult[0]?.cashAmount || 0;
        const kacchaRevenue = kacchaBillAmount + kacchaGstAmount + kacchaCashAmount;
        const kacchaNetSales = kacchaRevenue - totalReturns;
        const kacchaProfit = kacchaNetSales - totalExpenses;

        res.json({
            success: true,
            summary: {
                totalSales,
                totalReturns,
                netSales,
                totalExpenses,
                expensesByDepartment,
                netProfit,
                kacchaBillAmount,
                kacchaGstAmount,
                kacchaCashAmount,
                kacchaRevenue,
                kacchaNetSales,
                kacchaProfit,
                period: {
                    start,
                    end: finalEnd
                },
                partners: partners || []
            }
        });

    } catch (error) {
        console.error('Get finance summary error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
