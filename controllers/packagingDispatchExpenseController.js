import PackagingDispatchExpense, { PACKAGING_DISPATCH_EXPENSE_CATEGORIES } from '../models/PackagingDispatchExpense.js';

const cid = (req) => req.user.companyId;

const HEAD_ROLES = ['Packing Head', 'Dispatch Head', 'Superadmin', 'Super Admin'];

const canManage = (req, expense) => {
  if (HEAD_ROLES.includes(req.user.role)) return true;
  return expense.addedBy.toString() === req.user._id.toString();
};

// ─── GET /api/packaging-dispatch/expenses/categories ───────────────────────
export const getPackagingDispatchExpenseCategories = async (req, res) => {
  res.json({ success: true, data: PACKAGING_DISPATCH_EXPENSE_CATEGORIES });
};

// ─── POST /api/packaging-dispatch/expenses ─────────────────────────────────
export const createPackagingDispatchExpense = async (req, res) => {
  try {
    const { category, amount, date, notes } = req.body;

    if (!category || !PACKAGING_DISPATCH_EXPENSE_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: 'Invalid or missing expense category' });
    }
    const amountNum = Number(amount);
    if (!(amountNum > 0)) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });
    }

    const expense = await PackagingDispatchExpense.create({
      companyId: cid(req),
      category,
      amount: amountNum,
      date: date ? new Date(date) : new Date(),
      notes: notes || '',
      addedBy: req.user._id,
    });

    const populated = await expense.populate('addedBy', 'fullName username');
    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    console.error('Error creating packaging/dispatch expense:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/packaging-dispatch/expenses ──────────────────────────────────
export const getPackagingDispatchExpenses = async (req, res) => {
  try {
    const { category, month, from, to, page = 1, limit = 20 } = req.query;
    const query = { companyId: cid(req) };

    if (category) query.category = category;

    if (month) {
      // month = 'YYYY-MM'
      const [y, m] = month.split('-').map(Number);
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 1);
      query.date = { $gte: start, $lt: end };
    } else if (from || to) {
      query.date = {};
      if (from) query.date.$gte = new Date(from);
      if (to) query.date.$lte = new Date(to);
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const [expenses, total, totalAmountAgg] = await Promise.all([
      PackagingDispatchExpense.find(query)
        .populate('addedBy', 'fullName username')
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PackagingDispatchExpense.countDocuments(query),
      PackagingDispatchExpense.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    res.json({
      success: true,
      data: expenses,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalRecords: total,
      },
      totalAmount: totalAmountAgg[0]?.total || 0,
    });
  } catch (error) {
    console.error('Error fetching packaging/dispatch expenses:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/packaging-dispatch/expenses/summary ──────────────────────────
// Category-wise and month-wise totals, for future Expense Reports.
export const getPackagingDispatchExpenseSummary = async (req, res) => {
  try {
    const { month, year } = req.query;
    const query = { companyId: cid(req) };

    if (month) {
      const [y, m] = month.split('-').map(Number);
      query.date = { $gte: new Date(y, m - 1, 1), $lt: new Date(y, m, 1) };
    } else if (year) {
      query.date = { $gte: new Date(Number(year), 0, 1), $lt: new Date(Number(year) + 1, 0, 1) };
    }

    const [byCategory, byMonth, grandTotal] = await Promise.all([
      PackagingDispatchExpense.aggregate([
        { $match: query },
        { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),
      PackagingDispatchExpense.aggregate([
        { $match: { companyId: cid(req) } },
        {
          $group: {
            _id: { year: { $year: '$date' }, month: { $month: '$date' } },
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.year': -1, '_id.month': -1 } },
        { $limit: 12 },
      ]),
      PackagingDispatchExpense.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        byCategory: byCategory.map(c => ({ category: c._id, total: c.total, count: c.count })),
        byMonth: byMonth.map(m => ({ year: m._id.year, month: m._id.month, total: m.total, count: m.count })),
        grandTotal: grandTotal[0]?.total || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching packaging/dispatch expense summary:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── PUT /api/packaging-dispatch/expenses/:id ───────────────────────────────
export const updatePackagingDispatchExpense = async (req, res) => {
  try {
    const expense = await PackagingDispatchExpense.findOne({ _id: req.params.id, companyId: cid(req) });
    if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });

    if (!canManage(req, expense)) {
      return res.status(403).json({ success: false, message: 'You can only edit your own expense entries' });
    }

    const { category, amount, date, notes } = req.body;
    if (category !== undefined) {
      if (!PACKAGING_DISPATCH_EXPENSE_CATEGORIES.includes(category)) {
        return res.status(400).json({ success: false, message: 'Invalid expense category' });
      }
      expense.category = category;
    }
    if (amount !== undefined) {
      const amountNum = Number(amount);
      if (!(amountNum > 0)) return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });
      expense.amount = amountNum;
    }
    if (date !== undefined) expense.date = new Date(date);
    if (notes !== undefined) expense.notes = notes;

    await expense.save();
    const populated = await expense.populate('addedBy', 'fullName username');
    res.json({ success: true, data: populated });
  } catch (error) {
    console.error('Error updating packaging/dispatch expense:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── DELETE /api/packaging-dispatch/expenses/:id ────────────────────────────
export const deletePackagingDispatchExpense = async (req, res) => {
  try {
    const expense = await PackagingDispatchExpense.findOne({ _id: req.params.id, companyId: cid(req) });
    if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });

    if (!canManage(req, expense)) {
      return res.status(403).json({ success: false, message: 'You can only delete your own expense entries' });
    }

    await expense.deleteOne();
    res.json({ success: true, message: 'Expense deleted' });
  } catch (error) {
    console.error('Error deleting packaging/dispatch expense:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
