/** @format */

import Leave from "../models/Leave.js";
import LeaveType from "../models/LeaveType.js";
import LeaveBalanceAdjustment from "../models/LeaveBalanceAdjustment.js";
import User from "../models/User.js";
import { sendCommonEmail, CommonEmailType } from "../utils/email.js";
import mongoose from "mongoose";
import { canApprove, isInMyCompany, isPlatformAdmin } from "../utils/companyScope.js";
import notificationService from "../services/notificationService.js";

// ================= HELPER =================
const calculateDays = (from, to) => {
  const diff = new Date(to).getTime() - new Date(from).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
};

// The person's own company's leave type first, then one with no company. Matching
// by name alone picked up another company's rules (2026-11-11).
const findLeaveType = async (name, companyId) =>
  (companyId && (await LeaveType.findOne({ name, companyId }))) ||
  (await LeaveType.findOne({ name, $or: [{ companyId: { $exists: false } }, { companyId: null }] }));

// Days of this type left: allowed + HR's adjustments − approved so far.
const remainingLeave = async (employeeId, typeDoc, exceptLeaveId) => {
  const employee = new mongoose.Types.ObjectId(String(employeeId));
  const [used, adj] = await Promise.all([
    Leave.aggregate([
      { $match: { employee, leaveType: typeDoc.name, status: "APPROVED", ...(exceptLeaveId ? { _id: { $ne: exceptLeaveId } } : {}) } },
      { $group: { _id: null, total: { $sum: "$totalDays" } } },
    ]),
    LeaveBalanceAdjustment.aggregate([
      { $match: { employee, leaveType: typeDoc.name } },
      { $group: { _id: null, total: { $sum: "$adjustment" } } },
    ]),
  ]);
  return typeDoc.maxDays + (adj[0]?.total || 0) - (used[0]?.total || 0);
};

// ================= HR: ADD LEAVE FOR SOMEONE (2026-11-11) =================
// For anyone in the company, with or without a login. HR decides as they enter
// it, so it's saved approved. Never for yourself: that goes through Apply Leave.
const LEAVE_HR_ROLES = ["HR-Admin", "Hr Admin", "Company Admin"];
export const addLeaveForSomeone = async (req, res) => {
  try {
    const { employeeId, leaveType, fromDate, toDate, reason } = req.body;
    if (!employeeId || !leaveType || !fromDate || !toDate || !reason || !String(reason).trim()) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (!isPlatformAdmin(req.user) && !LEAVE_HR_ROLES.includes(req.user.role)) {
      return res.status(403).json({ message: "Only HR can add leave for someone." });
    }
    if (String(employeeId) === String(req.user._id)) {
      return res.status(400).json({ message: "For your own leave, use Apply Leave." });
    }
    if (!mongoose.isValidObjectId(employeeId) || !(await isInMyCompany(req.user, employeeId))) {
      return res.status(404).json({ message: "Person not found" });
    }
    const person = await User.findById(employeeId).select("fullName username email companyId");

    const totalDays = calculateDays(fromDate, toDate);
    if (!(totalDays > 0)) {
      return res.status(400).json({ message: "Invalid leave duration" });
    }
    const typeDoc = await findLeaveType(leaveType, person.companyId);
    if (!typeDoc) {
      return res.status(400).json({ message: "Invalid leave type" });
    }
    const clash = await Leave.exists({
      employee: person._id,
      status: { $in: ["PENDING", "APPROVED"] },
      fromDate: { $lte: new Date(toDate) },
      toDate: { $gte: new Date(fromDate) },
    });
    if (clash) {
      return res.status(400).json({ message: "This person already has leave on some of these days." });
    }
    const remaining = await remainingLeave(person._id, typeDoc);
    if (totalDays > remaining) {
      return res.status(400).json({ message: `Only ${remaining} leave(s) remaining for ${typeDoc.name}` });
    }

    const leave = await Leave.create({
      employee: person._id,
      leaveType: typeDoc.name,
      fromDate,
      toDate,
      totalDays,
      reason: String(reason).trim(),
      status: "APPROVED",
      addedBy: req.user._id,
    });

    // Same as an approval: email (only if they have an address) and a notification.
    if (person.email) {
      try {
        await sendCommonEmail({
          type: CommonEmailType.LEAVE_APPROVED,
          to: person.email,
          name: person.fullName || person.username,
          data: { from: leave.fromDate, to: leave.toDate, remark: "Added by HR" },
        });
      } catch (e) { console.error("Leave added email error:", e.message); }
    }
    try {
      await notificationService.triggerHRMSNotification({
        action: "leave_approved",
        data: { employeeUserId: person._id, fromDate: leave.fromDate, toDate: leave.toDate, reason: "Added by HR", leaveId: leave._id },
        targetCompanyId: person.companyId,
      });
    } catch (e) { console.error("Leave added notification error:", e); }

    res.status(201).json(leave);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to add leave" });
  }
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
    const leaveTypeDoc = await findLeaveType(leaveType, req.user.companyId);
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

    const leaveTypeDoc = await findLeaveType(leaveType, req.user.companyId);
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

    const current = await Leave.findById(id).select("employee").lean();
    if (!current) {
      return res.status(404).json({ message: "Leave not found" });
    }
    if (!(await canApprove(req.user, current.employee, { features: ["leaveRequests"] }))) {
      return res.status(403).json({ message: "You can't decide on this person's request." });
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

    // 📧 SEND EMAIL (someone with no login may have no address)
    if (employee.email) {
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
    }

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
