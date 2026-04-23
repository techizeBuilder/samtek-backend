import Expense from '../models/Expense.js';
import { USER_ROLES } from '../../shared/schema.js';

export const getExpenses = async (req, res) => {
    try {
        const { page = 1, limit = 10, category, unit, startDate, endDate, search } = req.query;
        const skip = (page - 1) * limit;

        let query = {};

        // Data isolation: Non-Super Admins only see their unit's expenses
        if (req.user.role !== USER_ROLES.SUPER_USER) {
            query.unit = req.user.unit;
            query.companyId = req.user.companyId;
        } else if (unit) {
            query.unit = unit;
        }

        if (category) {
            query.category = category;
        }

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        if (search) {
            query.$or = [
                { expenseType: { $regex: search, $options: 'i' } },
                { notes: { $regex: search, $options: 'i' } }
            ];
        }

        const expenses = await Expense.find(query)
            .populate('createdBy', 'username fullName')
            .sort({ date: -1, createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Expense.countDocuments(query);

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
    } catch (error) {
        console.error('Get expenses error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

export const createExpense = async (req, res) => {
    try {
        const {
            category,
            expenseType,
            amount,
            date,
            paymentMode,
            notes,
            unit,
            companyId
        } = req.body;

        const expenseData = {
            category,
            expenseType,
            amount,
            date: date || new Date(),
            paymentMode,
            notes,
            unit: req.user.role === USER_ROLES.SUPER_USER ? unit : req.user.unit,
            companyId: req.user.role === USER_ROLES.SUPER_USER ? companyId : req.user.companyId,
            createdBy: req.user._id
        };

        if (!expenseData.unit || !expenseData.companyId) {
            return res.status(400).json({ success: false, message: 'Unit and Company ID are required' });
        }

        const expense = await Expense.create(expenseData);
        await expense.populate('createdBy', 'username fullName');

        res.status(201).json({
            success: true,
            message: 'Expense recorded successfully',
            expense
        });
    } catch (error) {
        console.error('Create expense error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

export const updateExpense = async (req, res) => {
    try {
        const { id } = req.params;
        const expense = await Expense.findById(id);

        if (!expense) {
            return res.status(404).json({ success: false, message: 'Expense not found' });
        }

        // Access control
        if (req.user.role !== USER_ROLES.SUPER_USER && expense.unit !== req.user.unit) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const updatedExpense = await Expense.findByIdAndUpdate(
            id,
            { ...req.body, updatedAt: new Date() },
            { new: true }
        ).populate('createdBy', 'username fullName');

        res.json({
            success: true,
            message: 'Expense updated successfully',
            expense: updatedExpense
        });
    } catch (error) {
        console.error('Update expense error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

export const deleteExpense = async (req, res) => {
    try {
        const { id } = req.params;
        const expense = await Expense.findById(id);

        if (!expense) {
            return res.status(404).json({ success: false, message: 'Expense not found' });
        }

        // Access control
        if (req.user.role !== USER_ROLES.SUPER_USER && expense.unit !== req.user.unit) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        await Expense.findByIdAndDelete(id);

        res.json({ success: true, message: 'Expense deleted successfully' });
    } catch (error) {
        console.error('Delete expense error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

export const getExpenseStats = async (req, res) => {
    try {
        const { unit, startDate, endDate } = req.query;
        let query = {};

        if (req.user.role !== USER_ROLES.SUPER_USER) {
            query.unit = req.user.unit;
        } else if (unit) {
            query.unit = unit;
        }

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        const stats = await Expense.aggregate([
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
    } catch (error) {
        console.error('Get expense stats error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
