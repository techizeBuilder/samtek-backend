/** @format */

import Leave from "../models/Leave.js";
import LeaveType from "../models/LeaveType.js";
import LeaveBalanceAdjustment from "../models/LeaveBalanceAdjustment.js";
import User from "../models/User.js";
import { sendCommonEmail, CommonEmailType } from "../utils/email.js";
import mongoose from "mongoose";
import notificationService from "../services/notificationService.js";

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

    const empObjectId = new mongoose.Types.ObjectId(req.user._id);

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
      employee: req.user._id,
      leaveType,
      fromDate,
      toDate,
      totalDays,
      reason,
      status: "PENDING",
    });

    // 🔔 Notify HR Admin and Manager about leave request
    try {
      const employee = await User.findById(req.user._id).select('fullName username companyId');
      await notificationService.triggerHRMSNotification({
        action: 'leave_requested',
        data: {
          employeeName: employee?.fullName || employee?.username,
          fromDate,
          toDate,
          leaveType,
          leaveId: leave._id,
          employeeUserId: req.user._id,
        },
        targetCompanyId: req.user.companyId,
      });
    } catch (e) { console.error('Leave request notification error:', e); }

    res.status(201).json(leave);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to apply leave" });
  }
};

// ================= GET MY LEAVES =================
export const getMyLeaves = async (req, res) => {
  try {
    const { page, limit } = req.query;
    const query = { employee: req.user._id };

    if (page || limit) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 20);
      const [leaves, total] = await Promise.all([
        Leave.find(query).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum),
        Leave.countDocuments(query),
      ]);
      return res.json({
        data: leaves,
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
      });
    }

    const leaves = await Leave.find(query).sort({ createdAt: -1 });
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
      employee: req.user._id,
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

    const empObjectId = new mongoose.Types.ObjectId(req.user._id);

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
      employee: req.user._id,
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
    const managerId = req.user._id;
    const { search, page, limit } = req.query;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const leaves = await Leave.find({
      status: "APPROVED",
      fromDate: { $lte: today },
      toDate: { $gte: today },
    })
      .populate({
        path: "employee",
        select: "fullName role email reportingManager username",
        match: { reportingManager: managerId }, // ✅ sirf is manager ki team
      })
      .sort({ fromDate: 1 })
      .lean();

    // ❗ populate ke baad null employees hata do
    let filteredLeaves = leaves.filter((leave) => leave.employee).map(l => {
      if (l.employee) {
        l.employee.name = l.employee.fullName || l.employee.username || 'Unknown';
      }
      return l;
    });

    // Search by employee name or leave type — was previously done client-side.
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filteredLeaves = filteredLeaves.filter(
        (l) => re.test(l.employee?.name || '') || re.test(l.leaveType || '')
      );
    }

    // Pagination is opt-in via `page` — this "who's out today" widget is
    // naturally small (bounded by team size + a single day), so callers
    // that don't paginate still get the full list back.
    if (page) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.max(1, parseInt(limit) || 15);
      const total = filteredLeaves.length;
      const pageItems = filteredLeaves.slice((pageNum - 1) * limitNum, pageNum * limitNum);
      return res.json({
        data: pageItems,
        pagination: { current: pageNum, total: Math.ceil(total / limitNum) || 1, count: total },
      });
    }

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
    const managerId = req.user._id;
    const { search, status, page, limit } = req.query;

    // 🔹 Step 1: manager ke under ke employees
    const teamEmployees = await User.find({ reportingManager: managerId }, "_id");

    const employeeIds = teamEmployees.map((e) => e._id);

    // 🔹 Step 2: un employees ki leave requests
    const filter = { employee: { $in: employeeIds } };
    if (status && status !== 'all') filter.status = status;

    const fetchedLeaves = await Leave.find(filter)
      .populate("employee", "fullName username email role")
      .sort({ createdAt: -1 })
      .lean();

    let leaves = fetchedLeaves.map(l => {
      if (l.employee) {
        l.employee.name = l.employee.fullName || l.employee.username || 'Unknown';
      }
      return l;
    });

    // Search by employee name or leave type.
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      leaves = leaves.filter((l) => re.test(l.employee?.name || '') || re.test(l.leaveType || ''));
    }

    // Pagination is opt-in via `page` — LeavesEmployee.tsx's summary counts
    // still need the full unpaged array, so it can keep calling this with
    // no params.
    if (page) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.max(1, parseInt(limit) || 15);
      const total = leaves.length;
      const pageItems = leaves.slice((pageNum - 1) * limitNum, pageNum * limitNum);
      return res.status(200).json({
        data: pageItems,
        pagination: { current: pageNum, total: Math.ceil(total / limitNum) || 1, count: total },
      });
    }

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
    ).populate("employee", "fullName email");

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

    // 🔔 Notify employee about leave decision
    try {
      await notificationService.triggerHRMSNotification({
        action: status === 'APPROVED' ? 'leave_approved' : 'leave_rejected',
        data: {
          employeeUserId: leave.employee._id,
          fromDate: leave.fromDate,
          toDate: leave.toDate,
          reason: remark,
          leaveId: leave._id,
        },
        targetCompanyId: req.user.companyId,
      });
    } catch (e) { console.error('Leave status notification error:', e); }

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
    const { search, status, page, limit } = req.query;
    const filter = {};

    // If user is not a global Super Admin, filter by their company
    if (req.user.role !== 'Super Admin' && req.user.role !== 'Superadmin' && req.user.companyId) {
      // Find all users in the same company
      const usersInCompany = await User.find({ companyId: req.user.companyId }, "_id");
      const userIds = usersInCompany.map(u => u._id);
      filter.employee = { $in: userIds };
    }
    if (status && status !== 'all') filter.status = status;

    const fetchedLeaves = await Leave.find(filter)
      .populate("employee", "fullName username email role")
      .sort({ createdAt: -1 })
      .lean();

    let leaves = fetchedLeaves.map(l => {
      if (l.employee) {
        l.employee.name = l.employee.fullName || l.employee.username || 'Unknown';
      }
      return l;
    });

    // Search by employee name or leave type.
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      leaves = leaves.filter((l) => re.test(l.employee?.name || '') || re.test(l.leaveType || ''));
    }

    // Pagination is opt-in via `page` — PayrollRun.tsx also depends on this
    // endpoint for a full array (approved-leave-day counts per employee),
    // so it can keep calling with no params.
    if (page) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.max(1, parseInt(limit) || 15);
      const total = leaves.length;
      const pageItems = leaves.slice((pageNum - 1) * limitNum, pageNum * limitNum);
      return res.status(200).json({
        data: pageItems,
        pagination: { current: pageNum, total: Math.ceil(total / limitNum) || 1, count: total },
      });
    }

    res.status(200).json(leaves);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch leave requests",
    });
  }
};
