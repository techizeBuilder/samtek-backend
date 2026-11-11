/** @format */

import Payroll from "../models/Payroll.js";
import User from "../models/User.js";
import { employeeMatch, isInMyCompany } from "../utils/companyScope.js";
import { monthRows, personDays, runMonth, recalculateOne, PayrollError } from "../services/payroll/payrollService.js";

// The pay itself is worked out on the server (2026-11-11): services/payroll/.
const fail = (res, error, what) => {
  if (error instanceof PayrollError) return res.status(error.status).json({ message: error.message });
  console.error(error);
  return res.status(500).json({ message: `Failed to ${what}` });
};

/* ================= MONTH: the Payroll Run table, paged ================= */
export const getPayrollMonth = async (req, res) => {
  try {
    const { month, page, limit, search, companyId } = req.query;
    res.json(await monthRows(req.user, month, { page, limit, search, companyId }));
  } catch (error) { fail(res, error, "load payroll"); }
};

/* ================= ONE PERSON'S DAYS ================= */
export const getPayrollDays = async (req, res) => {
  try {
    const { month, userId, companyId } = req.query;
    res.json(await personDays(req.user, month, userId, { companyId }));
  } catch (error) { fail(res, error, "load the days"); }
};

/* ================= GET PAYROLL BY MONTH ================= */
export const getPayrollByMonth = async (req, res) => {
  try {
    const { month } = req.query;

    if (!month) {
      return res.status(400).json({ message: "Month required" });
    }

    let employeeIds;
    if (req.user.role !== 'Super Admin') {
      if (req.user.companyId) {
        const users = await User.find({ companyId: req.user.companyId }).select("_id");
        employeeIds = users.map(u => u._id);
      }
    } else {
      // Superadmin: optionally filter by companyId query param
      const { companyId } = req.query;
      if (companyId) {
        const users = await User.find({ companyId }).select("_id");
        employeeIds = users.map(u => u._id);
      }
    }

    const filter = { month };
    if (employeeIds) filter.employee = { $in: employeeIds };

    const payroll = await Payroll.find(filter)
      .populate("employee", "fullName username email role")
      .sort({ createdAt: -1 });

    const formattedPayroll = payroll.map(p => {
      const pObj = p.toObject();
      if (pObj.employee) {
        pObj.employee.name = pObj.employee.fullName || pObj.employee.username || 'Unknown';
      }
      return pObj;
    });

    res.json(formattedPayroll);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch payroll" });
  }
};

/* ================= RUN PAYROLL ================= */
// Numbers sent by the screen are ignored: the server works out everyone's pay.
export const savePayroll = async (req, res) => {
  try {
    const { month, companyId } = req.body;
    const result = await runMonth(req.user, month, { companyId });
    res.json({ message: `Payroll processed: ${result.created} added${result.kept ? `, ${result.kept} already run` : ""}`, ...result });
  } catch (error) { fail(res, error, "run payroll"); }
};

/* ================= UPDATE STATUS (Paid) ================= */
export const updatePayrollStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const existing = await Payroll.findById(req.params.id).select("employee").lean();
    if (!existing || !(await isInMyCompany(req.user, existing.employee))) {
      return res.status(404).json({ message: "Payroll not found" });
    }

    const payrollDoc = await Payroll.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).populate("employee", "fullName username email role");

    if (!payrollDoc) {
      return res.status(404).json({ message: "Payroll not found" });
    }

    const payroll = payrollDoc.toObject();
    if (payroll.employee) {
      payroll.employee.name = payroll.employee.fullName || payroll.employee.username || 'Unknown';
    }

    res.json(payroll);
  } catch (error) {
    res.status(500).json({ message: "Failed to update payroll status" });
  }
};
/* ================= RESET PAYROLL BY MONTH (DEV / ADMIN) ================= */
export const resetPayrollByMonth = async (req, res) => {
  try {
    const { month } = req.query;

    if (!month) {
      return res.status(400).json({ message: "Month required" });
    }

    // Only this company's: the month alone would reach every company.
    const scope = await employeeMatch(req.user);

    // ❌ Paid payroll delete nahi hone chahiye
    const paidExists = await Payroll.findOne({
      month,
      status: "Paid",
      ...scope,
    });

    if (paidExists) {
      return res.status(400).json({
        message: "Cannot reset payroll. Some salaries are already paid.",
      });
    }

    await Payroll.deleteMany({ month, ...scope });

    res.json({
      message: `Payroll reset successfully for ${month}`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to reset payroll" });
  }
};

// PATCH /payroll/:id/reject
export const rejectPayroll = async (req, res) => {
  const { reason } = req.body;

  if (!reason) {
    return res.status(400).json({ message: "Rejection reason required" });
  }

  const payroll = await Payroll.findById(req.params.id);
  if (!payroll || !(await isInMyCompany(req.user, payroll.employee))) {
    return res.status(404).json({ message: "Payroll not found" });
  }

  payroll.status = "Rejected";
  payroll.rejectReason = reason;
  payroll.rejectedAt = new Date();

  await payroll.save();

  res.json(payroll);
};
/* ================= RECALCULATE REJECTED PAYROLL ================= */
// Worked out again from today's attendance, leave and salary; numbers sent are ignored.
export const recalculatePayroll = async (req, res) => {
  try {
    const { payrollId } = req.body;
    if (!payrollId) return res.status(400).json({ message: "PayrollId required" });
    const payroll = await recalculateOne(req.user, payrollId);
    res.json({ message: "Payroll recalculated successfully", payroll });
  } catch (error) { fail(res, error, "recalculate payroll"); }
};
