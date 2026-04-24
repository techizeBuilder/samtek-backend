/** @format */

import Payroll from "../models/Payroll.js";

/* ================= GET PAYROLL BY MONTH ================= */
export const getPayrollByMonth = async (req, res) => {
  try {
    const { month } = req.query;

    if (!month) {
      return res.status(400).json({ message: "Month required" });
    }

    const payroll = await Payroll.find({ month })
      .populate("employee", "name email role")
      .sort({ createdAt: -1 });

    res.json(payroll);
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
            status: "Processed",
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

    const payroll = await Payroll.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).populate("employee", "name email role");

    if (!payroll) {
      return res.status(404).json({ message: "Payroll not found" });
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

    payroll.status = "Processed"; // 🔥 reset status
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
