/** @format */

import AttendanceRequest from "../models/AttendanceRequest.js";
import Attendance from "../models/Attendance.js";
import User from "../models/User.js";
import notificationService from "../services/notificationService.js";

/* ================= EMPLOYEE: CREATE REQUEST ================= */
export const createAttendanceRequest = async (req, res) => {
  try {
    const { date, type, punchIn, punchOut, reason } = req.body;
    const userId = req.user._id;

    const request = new AttendanceRequest({
      user: userId,
      date,
      type,
      punchIn,
      punchOut,
      reason,
      status: "PENDING",
    });

    await request.save();

    // 🔔 Notify HR Admin and Manager
    try {
      const employee = await User.findById(req.user._id).select('fullName username companyId');
      await notificationService.triggerHRMSNotification({
        action: 'attendance_correction_requested',
        data: {
          employeeName: employee?.fullName || employee?.username,
          date,
          type,
          requestId: request._id,
          employeeUserId: req.user._id,
        },
        targetCompanyId: req.user.companyId,
      });
    } catch (e) { console.error('Attendance request notification error:', e); }

    res.status(201).json({
      message: "Attendance request submitted successfully",
      request,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to submit attendance request" });
  }
};

/* ================= EMPLOYEE: GET MY REQUESTS ================= */
export const getMyAttendanceRequests = async (req, res) => {
  try {
    const requests = await AttendanceRequest.find({ user: req.user._id }).sort({
      createdAt: -1,
    });
    res.json(requests);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch attendance requests" });
  }
};

/* ================= EMPLOYEE: UPDATE REQUEST ================= */
export const updateAttendanceRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, type, punchIn, punchOut, reason } = req.body;

    const request = await AttendanceRequest.findOne({
      _id: id,
      user: req.user._id,
    });

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (request.status !== "PENDING") {
      return res
        .status(400)
        .json({ message: "Cannot update processed request" });
    }

    request.date = date || request.date;
    request.type = type || request.type;
    request.punchIn = punchIn || request.punchIn;
    request.punchOut = punchOut || request.punchOut;
    request.reason = reason || request.reason;

    await request.save();
    res.json({ message: "Attendance request updated successfully", request });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update attendance request" });
  }
};

/* ================= EMPLOYEE: DELETE REQUEST ================= */
export const deleteAttendanceRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await AttendanceRequest.findOneAndDelete({
      _id: id,
      user: req.user._id,
      status: "PENDING",
    });

    if (!request) {
      return res
        .status(404)
        .json({ message: "Request not found or already processed" });
    }

    res.json({ message: "Attendance request deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to delete attendance request" });
  }
};

/* ================= MANAGER: GET TEAM REQUESTS ================= */
export const getTeamAttendanceRequests = async (req, res) => {
  try {
    const managerId = req.user._id;

    // 1️⃣ Get team members
    const teamMembers = await User.find({ reportingManager: managerId }, "_id fullName username email role");
    const teamIds = teamMembers.map((u) => u._id);

    // 2️⃣ Get attendance requests for those members
    const fetchedRequests = await AttendanceRequest.find({
      user: { $in: teamIds },
    })
      .populate("user", "fullName username email role")
      .sort({ createdAt: -1 })
      .lean();

    const requests = fetchedRequests.map(r => {
      if (r.user) {
        r.user.name = r.user.fullName || r.user.username || 'Unknown';
      }
      return r;
    });

    res.json(requests);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch team attendance requests",
    });
  }
};

/* ================= MANAGER: UPDATE STATUS ================= */
export const updateAttendanceRequestStatus = async (req, res) => {
  try {
    const { status, adminRemark } = req.body;
    const { id } = req.params;

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const request = await AttendanceRequest.findById(id);
    if (!request) {
      return res.status(404).json({ message: "Attendance request not found" });
    }

    if (request.status !== "PENDING") {
      return res.status(400).json({ message: "Request already processed" });
    }

    request.status = status;
    request.adminRemark = adminRemark;

    /* 🔄 IF APPROVED, UPDATE ACTUAL ATTENDANCE 🔄 */
    if (status === "APPROVED") {
      const { user, date, punchIn, punchOut } = request;

      // Update or Create actual attendance record
      await Attendance.findOneAndUpdate(
        { user, date },
        {
          punchIn: punchIn ? new Date(`${date}T${punchIn}`) : undefined,
          punchOut: punchOut ? new Date(`${date}T${punchOut}`) : undefined,
          status: "PRESENT",
        },
        { upsert: true, new: true }
      );
    }

    await request.save();

    // 🔔 Notify employee about attendance decision
    try {
      await notificationService.triggerHRMSNotification({
        action: 'attendance_approved',
        data: {
          employeeUserId: request.user,
          date: request.date,
          status,
          requestId: request._id,
        },
        targetCompanyId: req.user.companyId,
      });
    } catch (e) { console.error('Attendance approval notification error:', e); }

    res.json(request);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to update attendance request status",
    });
  }
};

/* ================= ADMIN / HR: GET ALL REQUESTS ================= */
export const getAllAttendanceRequests = async (req, res) => {
  try {
    const filter = {};

    // If user is not a global Super Admin, filter by their company
    if (req.user.role !== 'Super Admin' && req.user.role !== 'Superadmin' && req.user.companyId) {
      // Find all users in the same company
      const usersInCompany = await User.find({ companyId: req.user.companyId }, "_id");
      const userIds = usersInCompany.map(u => u._id);
      filter.user = { $in: userIds };
    }

    const fetchedRequests = await AttendanceRequest.find(filter)
      .populate("user", "fullName username email role")
      .sort({ createdAt: -1 })
      .lean();

    const requests = fetchedRequests.map(r => {
      if (r.user) {
        r.user.name = r.user.fullName || r.user.username || 'Unknown';
      }
      return r;
    });

    res.json(requests);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch attendance requests",
    });
  }
};
