import Sale from '../models/Sale.js';
import Return from '../models/Return.js';
import Expense from '../models/Expense.js';
import { Partner } from '../models/Partner.js';
import mongoose from 'mongoose';
import { USER_ROLES } from '../shared/schema.js';

export const getFinanceSummary = async (req, res) => {
    try {
        const { unit, startDate, endDate, period = 'month' } = req.query;

        let query = {};
        // If user is Super Admin or Accountant, allow viewing consolidated summary (all units)
        // unless a specific unit filter is provided in the query.
        if (req.user.role === USER_ROLES.SUPER_ADMIN || req.user.role === USER_ROLES.SUPER_USER || req.user.role === 'Accounts') {
            if (unit) {
                query.unit = unit;
            }
            // If no unit provided, query stays empty {} which means "All Units"
        } else {
            // For other roles (like Unit Head), restrict to their own unit
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

        // Aggregate Sales (Revenue)
        // In Sale.js, it's 'saleDate' or 'createdAt'
        const salesPromise = Sale.aggregate([
            {
                $match: {
                    ...query,
                    saleDate: dateQuery
                }
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

        // Aggregate Expenses
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
                    total: { $sum: '$amount' }
                }
            }
        ]);

        const partnersPromise = Partner.find({ companyId: req.user.companyId, isActive: true }).lean();

        const [salesResult, returnsResult, expensesResult, partners] = await Promise.all([
            salesPromise,
            returnsPromise,
            expensesPromise,
            partnersPromise
        ]);

        const totalSales = salesResult[0]?.total || 0;
        const totalReturns = returnsResult[0]?.total || 0;
        const netSales = totalSales - totalReturns;
        const totalExpenses = expensesResult[0]?.total || 0;
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

    } catch (error) {
        console.error('Get finance summary error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
