/** @format */

import Leave from "../models/Leave.js";
import LeaveType from "../models/LeaveType.js";
import LeaveBalanceAdjustment from "../models/LeaveBalanceAdjustment.js";
import User from "../models/User.js";
import { sendCommonEmail, CommonEmailType } from "../utils/email.js";
import mongoose from "mongoose";

// ================= HELPER =================
const calculateDays = (from, to) => {
  const diff = new Date(to).getTime() - new Date(from).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
};

// ================= APPLY LEAVE =================
export const applyLeave = async (req, res) => {
  try {
    const { leaveType, fromDate, toDate, reason } = req.body;

    if (!leaveType || !fromDate || !toDate || !reason) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // 🔹 calculate requested days
    const totalDays = calculateDays(fromDate, toDate);

    if (totalDays <= 0) {
      return res.status(400).json({ message: "Invalid leave duration" });
    }

    // 🔹 get leave type config
    const leaveTypeDoc = await LeaveType.findOne({ name: leaveType });
    if (!leaveTypeDoc) {
      return res.status(400).json({ message: "Invalid leave type" });
    }

    const empObjectId = new mongoose.Types.ObjectId(req.user.id);

    // 🔹 calculate used leaves (APPROVED only)
    const usedAgg = await Leave.aggregate([
      {
        $match: {
          employee: empObjectId,
          leaveType,
          status: "APPROVED",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalDays" },
        },
      },
    ]);

    const usedLeaves = usedAgg[0]?.total || 0;

    // 🔹 calculate sum of manual adjustments
    const adjAgg = await LeaveBalanceAdjustment.aggregate([
      {
        $match: {
          employee: empObjectId,
          leaveType,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$adjustment" },
        },
      },
    ]);
    const totalAdjustments = adjAgg[0]?.total || 0;

    const remainingLeaves = leaveTypeDoc.maxDays + totalAdjustments - usedLeaves;

    // 🔹 validation
    if (totalDays > remainingLeaves) {
      return res.status(400).json({
        message: `Only ${remainingLeaves} leave(s) remaining for ${leaveType}`,
      });
    }

    // 🔹 create leave (NO remainingLeaves saved)
    const leave = await Leave.create({
      employee: req.user.id,
      leaveType,
      fromDate,
      toDate,
      totalDays,
      reason,
      status: "PENDING",
    });

    res.status(201).json(leave);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to apply leave" });
  }
};

// ================= GET MY LEAVES =================
export const getMyLeaves = async (req, res) => {
  try {
    const leaves = await Leave.find({
      employee: req.user.id,
    }).sort({ createdAt: -1 });

    res.json(leaves);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch leaves" });
  }
};

// ================= UPDATE LEAVE =================
export const updateLeave = async (req, res) => {
  try {
    const { leaveType, fromDate, toDate, reason } = req.body;

    const leave = await Leave.findOne({
      _id: req.params.id,
      employee: req.user.id,
    });

    if (!leave) {
      return res.status(404).json({ message: "Leave not found" });
    }

    if (leave.status !== "PENDING") {
      return res
        .status(400)
        .json({ message: "Approved / Rejected leave can't be edited" });
    }

    const totalDays = calculateDays(fromDate, toDate);

    const leaveTypeDoc = await LeaveType.findOne({ name: leaveType });
    if (!leaveTypeDoc) {
      return res.status(400).json({ message: "Invalid leave type" });
    }

    const empObjectId = new mongoose.Types.ObjectId(req.user.id);

    const usedAgg = await Leave.aggregate([
      {
        $match: {
          employee: empObjectId,
          leaveType,
          status: "APPROVED",
          _id: { $ne: leave._id },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalDays" },
        },
      },
    ]);

    const usedLeaves = usedAgg[0]?.total || 0;

    // 🔹 calculate sum of manual adjustments
    const adjAgg = await LeaveBalanceAdjustment.aggregate([
      {
        $match: {
          employee: empObjectId,
          leaveType,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$adjustment" },
        },
      },
    ]);
    const totalAdjustments = adjAgg[0]?.total || 0;

    const remainingLeaves = leaveTypeDoc.maxDays + totalAdjustments - usedLeaves;

    if (totalDays > remainingLeaves) {
      return res.status(400).json({
        message: `Only ${remainingLeaves} leave(s) remaining for ${leaveType}`,
      });
    }

    leave.leaveType = leaveType;
    leave.fromDate = fromDate;
    leave.toDate = toDate;
    leave.totalDays = totalDays;
    leave.reason = reason;

    await leave.save();

    res.json(leave);
  } catch (error) {
    res.status(500).json({ message: "Failed to update leave" });
  }
};

// ================= DELETE LEAVE =================
export const deleteLeave = async (req, res) => {
  try {
    const leave = await Leave.findOneAndDelete({
      _id: req.params.id,
      employee: req.user.id,
      status: "PENDING",
    });

    if (!leave) {
      return res
        .status(404)
        .json({ message: "Leave not found or can't be deleted" });
    }

    res.json({ message: "Leave deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete leave" });
  }
};

export const getTodayTeamLeaves = async (req, res) => {
  try {
    const managerId = req.user.id;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const leaves = await Leave.find({
      status: "APPROVED",
      fromDate: { $lte: today },
      toDate: { $gte: today },
    })
      .populate({
        path: "employee",
        select: "name role email managerId",
        match: { managerId }, // ✅ sirf is manager ki team
      })
      .sort({ fromDate: 1 });

    // ❗ populate ke baad null employees hata do
    const filteredLeaves = leaves.filter((leave) => leave.employee);

    res.json(filteredLeaves);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch today team leaves",
    });
  }
};

export const getAllLeaveRequests = async (req, res) => {
  try {
    const managerId = req.user.id;

    // 🔹 Step 1: manager ke under ke employees
    const teamEmployees = await User.find({ managerId }, "_id");

    const employeeIds = teamEmployees.map((e) => e._id);

    // 🔹 Step 2: un employees ki leave requests
    const leaves = await Leave.find({
      employee: { $in: employeeIds },
    })
      .populate("employee", "name email role")
      .sort({ createdAt: -1 });

    res.status(200).json(leaves);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch leave requests",
    });
  }
};


/* ================= UPDATE LEAVE STATUS ================= */
export const updateLeaveStatus = async (req, res) => {
  try {
    const { status, remark } = req.body;
    const { id } = req.params;

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const leave = await Leave.findByIdAndUpdate(
      id,
      { status, remark },
      { new: true },
    ).populate("employee", "name email");

    if (!leave || !leave.employee) {
      return res.status(404).json({ message: "Leave not found" });
    }

    const employee = leave.employee;

    // 📧 SEND EMAIL
    await sendCommonEmail({
      type:
        status === "APPROVED"
          ? CommonEmailType.LEAVE_APPROVED
          : CommonEmailType.LEAVE_REJECTED,
      to: employee.email,
      name: employee.name,
      data: {
        from: leave.fromDate,
        to: leave.toDate,
        remark,
      },
    });

    res.status(200).json(leave);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update leave status" });
  }
};

// ================= GET ALL EMPLOYEES LEAVE REQUESTS (HR / ADMIN) =================
export const getAllEmployeesLeaveRequests = async (
  req,
  res
) => {
  try {
    const leaves = await Leave.find({})
      .populate("employee", "name email role managerId")
      .sort({ createdAt: -1 });

    res.status(200).json(leaves);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch all leave requests",
    });
  }
};
