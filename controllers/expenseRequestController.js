/** @format */

import Expense from "../models/ExpenseRequest.js";
import User from "../models/User.js";
import notificationService from "../services/notificationService.js";

/* ================= EMPLOYEE: CREATE EXPENSE ================= */
export const createExpense = async (req, res) => {
  try {
    const { 
      expenseType, 
      subCategory, 
      billingType, 
      travelRequestId, 
      amount, 
      date, 
      remarks 
    } = req.body;

    const expense = await Expense.create({
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

    // 🔔 Notify Manager and HR Admin about expense submission
    try {
      const employee = await User.findById(req.user._id).select('fullName username');
      await notificationService.triggerHRMSNotification({
        action: 'expense_submitted',
        data: {
          employeeName: employee?.fullName || employee?.username,
          amount,
          expenseType,
          expenseId: expense._id,
          employeeUserId: req.user._id,
        },
        targetCompanyId: req.user.companyId,
      });
    } catch (e) { console.error('Expense submitted notification error:', e); }
  } catch (error) {
    res.status(500).json({ message: "Failed to submit expense" });
  }
};

/* ================= EMPLOYEE: MY EXPENSES ================= */
export const getMyExpenses = async (req, res) => {
  try {
    const expenses = await Expense.find({
      employee: req.user._id,
    }).sort({ createdAt: -1 });

    res.json(expenses);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch expenses" });
  }
};

/* ================= MANAGER: TEAM EXPENSE REQUESTS ================= */
export const getTeamExpenseRequests = async (
  req,
  res
) => {
  try {
    const managerId = req.user._id;

    // 🔹 manager ke under employees
    const teamEmployees = await User.find({ reportingManager: managerId }, "_id fullName username email");

    const employeeIds = teamEmployees.map((e) => e._id);

    // 🔹 unhi employees ke expenses
    const fetchedExpenses = await Expense.find({
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
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch expense requests",
    });
  }
};

/* ================= MANAGER: UPDATE STATUS ================= */
export const updateExpenseStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!["APPROVED", "REJECTED","PAID"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const expense = await Expense.findById(req.params.id);

    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }

    expense.status = status;
    await expense.save();

    // 🔔 Notify employee about expense decision
    if (status === 'APPROVED' || status === 'REJECTED') {
      try {
        await notificationService.triggerHRMSNotification({
          action: 'expense_approved',
          data: {
            employeeUserId: expense.employee,
            amount: expense.amount,
            status,
            expenseId: expense._id,
          },
          targetCompanyId: req.user.companyId,
        });
      } catch (e) { console.error('Expense status notification error:', e); }
    }

    res.json(expense);
  } catch (error) {
    res.status(500).json({ message: "Failed to update expense status" });
  }
};

/* ================= EMPLOYEE: UPDATE (ONLY PENDING) ================= */
export const updateExpense = async (req, res) => {
  try {
    const { 
      expenseType, 
      subCategory, 
      billingType, 
      travelRequestId, 
      amount, 
      date, 
      remarks 
    } = req.body;

    const expense = await Expense.findOne({
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

    await expense.save();
    res.json({ message: "Expense updated successfully", expense });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update expense" });
  }
};

/* ================= EMPLOYEE: DELETE (ONLY PENDING) ================= */
export const deleteExpense = async (req, res) => {
  const expense = await Expense.findOneAndDelete({
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
};

/* ================= ADMIN / FINANCE: ALL EXPENSE REQUESTS ================= */
export const getAllExpenseRequests = async (
  req,
  res
) => {
  try {
    const filter = {};

    // Company-wise isolation — SuperAdmin can see all, others only their company
    if (req.user.role !== 'Super Admin' && req.user.role !== 'Superadmin' && req.user.companyId) {
      const usersInCompany = await User.find({ companyId: req.user.companyId }, "_id");
      const userIds = usersInCompany.map(u => u._id);
      filter.employee = { $in: userIds };
    }

    const fetchedExpenses = await Expense.find(filter)
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
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch all expense requests",
    });
  }
};
/* ================= ADMIN / FINANCE: PAY EXPENSE REQUEST ================= */
export const payExpenseRequest = async (req, res) => {
  try {
    const { paymentMode, notes } = req.body;
    const expenseRequestId = req.params.id;

    const expenseRequest = await Expense.findById(expenseRequestId).populate("employee");
    if (!expenseRequest) {
      return res.status(404).json({ message: "Expense request not found" });
    }

    if (expenseRequest.status === "PAID") {
      return res.status(400).json({ message: "Expense already paid" });
    }

    const { Transaction, Account } = await import("../models/Account.js");
    const RealExpense = (await import("../models/Expense.js")).default;
    const employee = expenseRequest.employee;
    const unit = req.user.unit || employee.unit;
    const companyId = req.user.companyId || employee.companyId;

    // 1. Create Real Expense Record
    const realExpense = await RealExpense.create({
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
    const expenseAccount = await Account.findOne({ accountName: 'Indirect Expenses', unit });
    const paymentAccount = await Account.findOne({ accountName: paymentMode === 'Bank Transfer' ? 'Bank Account' : 'Cash Account', unit });

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
      await txn.save();

      // Update account balances
      expenseAccount.balance += expenseRequest.amount;
      paymentAccount.balance -= expenseRequest.amount;

      await expenseAccount.save();
      await paymentAccount.save();
    }

    // 3. Update Request Status
    expenseRequest.status = "PAID";
    await expenseRequest.save();

    res.json({ success: true, message: "Expense paid and recorded in ledger", data: realExpense });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to process payment: " + error.message });
  }
};
