/** @format */

import Overtime from "../models/Overtime.js";
import User from "../models/User.js";

/* ================= CREATE ================= */
export const createOvertime = async (req, res) => {
  try {
    const { date, startTime, endTime, reason } = req.body;

    if (!date || !startTime || !endTime || !reason) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // hours calculate
    const start = new Date(`1970-01-01T${startTime}`);
    const end = new Date(`1970-01-01T${endTime}`);
    const diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

    if (diff <= 0) {
      return res.status(400).json({ message: "Invalid time range" });
    }

    const overtime = await Overtime.create({
      employee: req.user._id,
      date,
      startTime,
      endTime,
      hours: diff,
      reason,
    });

    res.status(201).json(overtime);
  } catch (error) {
    res.status(500).json({ message: "Failed to create overtime request" });
  }
};

/* ================= GET MY REQUESTS ================= */
export const getMyOvertimeRequests = async (
  req,
  res,
) => {
  try {
    const { page, limit } = req.query;
    const query = { employee: req.user._id };

    if (page || limit) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 20);
      const [data, total] = await Promise.all([
        Overtime.find(query).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum),
        Overtime.countDocuments(query),
      ]);
      return res.json({
        data,
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
      });
    }

    const data = await Overtime.find(query).sort({ createdAt: -1 });
    res.json(data);
  } catch {
    res.status(500).json({ message: "Failed to fetch overtime requests" });
  }
};

/* ================= UPDATE ================= */
export const updateOvertime = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, startTime, endTime, reason, status } = req.body;

    const overtime = await Overtime.findById(id);

    if (!overtime) {
      return res.status(404).json({
        message: "Overtime request not found",
      });
    }

    /* ================= ROLE BASED LOGIC ================= */

    // 🔹 EMPLOYEE (any "...Employee" role, e.g. Sales Employee, Production
    // Employee — not just the literal "Employee" role): can edit only when PENDING
    if ((req.user.role || "").toLowerCase().endsWith("employee")) {
      if (
        overtime.employee.toString() !== req.user._id.toString() ||
        overtime.status !== "PENDING"
      ) {
        return res.status(403).json({
          message: "You are not allowed to update this request",
        });
      }

      if (date) overtime.date = date;
      if (startTime) overtime.startTime = startTime;
      if (endTime) overtime.endTime = endTime;
      if (reason) overtime.reason = reason;

      // recalc hours
      const start = new Date(`1970-01-01T${overtime.startTime}`);
      const end = new Date(`1970-01-01T${overtime.endTime}`);
      overtime.hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    }

    // 🔹 MANAGER: can approve / reject
    if (req.user.role === "Manager") {
      if (!["APPROVED", "REJECTED"].includes(status)) {
        return res.status(400).json({
          message: "Invalid status",
        });
      }

      if (overtime.status !== "PENDING") {
        return res.status(400).json({
          message: "Request already processed",
        });
      }

      overtime.status = status
    }

    await overtime.save();

    res.json({
      message: "Overtime request updated successfully",
      overtime,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to update overtime request",
    });
  }
};


/* ================= DELETE ================= */
export const deleteOvertime = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await Overtime.findOneAndDelete({
      _id: id,
      employee: req.user._id,
      status: "PENDING",
    });

    if (!deleted) {
      return res
        .status(404)
        .json({ message: "Overtime request not found or locked" });
    }

    res.json({ message: "Overtime request deleted successfully" });
  } catch {
    res.status(500).json({ message: "Failed to delete overtime request" });
  }
};
/* ================= GET TEAM REQUESTS (MANAGER) ================= */
export const getTeamOvertimeRequests = async (
  req,
  res,
) => {
  try {
    const managerId = req.user._id;

    // 1️⃣ find team members (jinka reportingManager = logged-in manager)
    const teamMembers = await User.find({ reportingManager: managerId }, "_id fullName username email role");

    const teamIds = teamMembers.map((u) => u._id);

    // 2️⃣ un employees ki overtime requests
    const fetchedRequests = await Overtime.find({
      employee: { $in: teamIds },
    })
      .populate("employee", "fullName username email role")
      .sort({ createdAt: -1 })
      .lean();

    const requests = fetchedRequests.map(r => {
      if (r.employee) {
        r.employee.name = r.employee.fullName || r.employee.username || 'Unknown';
      }
      return r;
    });

    res.json(requests);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch team overtime requests",
    });
  }
};
