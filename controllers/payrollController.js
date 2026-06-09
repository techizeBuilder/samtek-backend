/** @format */

import Payroll from "../models/Payroll.js";
import User from "../models/User.js";

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

/* ================= SAVE / UPDATE PAYROLL (RUN PAYROLL) ================= */
export const savePayroll = async (req, res) => {
  try {
    const { month, payroll } = req.body;

    if (!month || !Array.isArray(payroll)) {
      return res.status(400).json({ message: "Invalid payload" });
    }

    const bulkOps = payroll.map((p) => ({
      updateOne: {
        filter: { employee: p.userId, month },
        update: {
          $set: {
            gross: p.gross,
            deduction: p.deduction,
            net: p.net,
            payDays: p.payDays || 0,
            lopDays: p.lopDays || 0,
            status: "Paid",
          },
        },
        upsert: true,
      },
    }));

    await Payroll.bulkWrite(bulkOps);

    res.json({ message: "Payroll processed successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to save payroll" });
  }
};

/* ================= UPDATE STATUS (Paid) ================= */
export const updatePayrollStatus = async (req, res) => {
  try {
    const { status } = req.body;

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

    // ❌ Paid payroll delete nahi hone chahiye
    const paidExists = await Payroll.findOne({
      month,
      status: "Paid",
    });

    if (paidExists) {
      return res.status(400).json({
        message: "Cannot reset payroll. Some salaries are already paid.",
      });
    }

    await Payroll.deleteMany({ month });

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
  if (!payroll) {
    return res.status(404).json({ message: "Payroll not found" });
  }

  payroll.status = "Rejected";
  payroll.rejectReason = reason;
  payroll.rejectedAt = new Date();

  await payroll.save();

  res.json(payroll);
};
/* ================= RECALCULATE REJECTED PAYROLL ================= */
export const recalculatePayroll = async (
  req,
  res
) => {
  try {
    const { payrollId, gross, deduction, net } = req.body;

    if (!payrollId) {
      return res.status(400).json({ message: "PayrollId required" });
    }

    const payroll = await Payroll.findById(payrollId);

    if (!payroll) {
      return res.status(404).json({ message: "Payroll not found" });
    }

    // 🔒 SAFETY CHECKS
    if (payroll.status === "Paid") {
      return res
        .status(400)
        .json({ message: "Paid payroll cannot be recalculated" });
    }

    if (payroll.status !== "Rejected") {
      return res
        .status(400)
        .json({ message: "Only rejected payroll can be recalculated" });
    }

    // 👉 UPDATE WITH NEW CALCULATION
    payroll.gross = gross;
    payroll.deduction = deduction;
    payroll.net = net;
    payroll.payDays = req.body.payDays || 0;
    payroll.lopDays = req.body.lopDays || 0;

    payroll.status = "Paid"; // 🔥 reset status directly to paid
    payroll.rejectReason = undefined;
    payroll.rejectedAt = undefined;

    await payroll.save();

    res.json({
      message: "Payroll recalculated successfully",
      payroll,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to recalculate payroll" });
  }
};
