/** @format */

import ProfileUpdate from "../models/ProfileUpdate.js";
import User from "../models/User.js";

/* ================= CREATE ================= */
export const createProfileUpdate = async (req, res) => {
  try {
    const { updateType, newValue, reason } = req.body;

    if (!updateType || !newValue || !reason) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    const request = await ProfileUpdate.create({
      employee: req.user._id,
      updateType,
      newValue,
      reason,
    });

    res.status(201).json(request);
  } catch (err) {
    res.status(500).json({
      message: err.message || "Failed to create profile update request",
    });
  }
};

/* ================= GET MY REQUESTS ================= */
export const getMyProfileUpdates = async (req, res) => {
  try {
    const requests = await ProfileUpdate.find({
      employee: req.user._id,
    }).sort({ createdAt: -1 });

    res.json(requests);
  } catch {
    res.status(500).json({ message: "Failed to fetch requests" });
  }
};

/* ================= UPDATE (EDIT) ================= */
export const updateProfileUpdate = async (req, res) => {
  try {
    const { updateType, newValue, reason, status } = req.body;
    const requestId = req.params.id;

    const request = await ProfileUpdate.findById(requestId);

    if (!request) {
      return res.status(404).json({
        message: "Profile update request not found",
      });
    }

    /* ================= EMPLOYEE EDIT ================= */
    if (status === undefined) {
      // only owner can edit & only PENDING
      if (
        request.employee.toString() !== req.user._id ||
        request.status !== "PENDING"
      ) {
        return res.status(403).json({
          message: "You are not allowed to edit this request",
        });
      }

      if (!updateType || !newValue || !reason) {
        return res.status(400).json({
          message: "All fields are required",
        });
      }

      request.updateType = updateType;
      request.newValue = newValue;
      request.reason = reason;

      await request.save();
      return res.json(request);
    }

    /* ================= MANAGER / HR STATUS UPDATE ================= */
    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({
        message: "Invalid status value",
      });
    }

    if (request.status !== "PENDING") {
      return res.status(400).json({
        message: "Request already processed",
      });
    }

    request.status = status;

    /* ================= APPLY PROFILE CHANGE ON APPROVE ================= */
    if (status === "APPROVED") {
      await User.findByIdAndUpdate(request.employee, {
        [request.updateType]: request.newValue,
      });
    }

    await request.save();

    res.json(request);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to update profile request",
    });
  }
};

/* ================= DELETE ================= */
export const deleteProfileUpdate = async (req, res) => {
  try {
    const request = await ProfileUpdate.findOneAndDelete({
      _id: req.params.id,
      employee: req.user._id,
      status: "PENDING",
    });

    if (!request) {
      return res.status(404).json({
        message: "Request not found or cannot be deleted",
      });
    }

    res.json({ message: "Profile update request deleted successfully" });
  } catch {
    res.status(500).json({ message: "Failed to delete request" });
  }
};

export const getTeamProfileUpdateRequests = async (
  req,
  res,
) => {
  try {
    const managerId = req.user._id;

    // 1️⃣ find employees under this manager
    const teamMembers = await User.find({ managerId }, "_id name email role");

    const teamIds = teamMembers.map((u) => u._id);

    // 2️⃣ fetch profile update requests of those employees
    const requests = await ProfileUpdate.find({
      employee: { $in: teamIds },
    })
      .populate("employee", "name email role")
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch team profile update requests",
    });
  }
};
