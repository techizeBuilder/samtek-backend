/** @format */

import LeaveType from "../models/LeaveType.js";

// @desc    Add new Leave Type
// @route   POST /api/leave-types
export const addLeaveType = async (req, res) => {
  try {
    const { name, code, maxDays, paid, carryForward, isActive } = req.body;

    const existingLeaveType = await LeaveType.findOne({ code });
    if (existingLeaveType) {
      return res.status(400).json({ message: "Leave type with this code already exists" });
    }

    const leaveType = await LeaveType.create({
      name,
      code,
      maxDays,
      paid,
      carryForward,
      isActive,
    });

    res.status(201).json({ message: "Leave type created successfully", leaveType });
  } catch (error) {
    console.error("Error creating leave type:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// @desc    Get all Leave Types
// @route   GET /api/leave-types
export const getAllLeaveTypes = async (req, res) => {
  try {
    const leaveTypes = await LeaveType.find().sort({ createdAt: -1 });
    res.status(200).json(leaveTypes);
  } catch (error) {
    console.error("Error fetching leave types:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// @desc    Get a single Leave Type by ID
// @route   GET /api/leave-types/:id
export const getLeaveTypeById = async (req, res) => {
  try {
    const leaveType = await LeaveType.findById(req.params.id);
    if (!leaveType) {
      return res.status(404).json({ message: "Leave type not found" });
    }
    res.status(200).json(leaveType);
  } catch (error) {
    console.error("Error fetching leave type by ID:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// @desc    Update a Leave Type
// @route   PUT /api/leave-types/:id
export const updateLeaveType = async (req, res) => {
  try {
    const { name, code, maxDays, paid, carryForward, isActive } = req.body;

    const leaveType = await LeaveType.findById(req.params.id);
    if (!leaveType) {
      return res.status(404).json({ message: "Leave type not found" });
    }

    if (code && code !== leaveType.code) {
      const existingLeaveType = await LeaveType.findOne({ code });
      if (existingLeaveType) {
        return res.status(400).json({ message: "Leave type with this code already exists" });
      }
    }

    leaveType.name = name !== undefined ? name : leaveType.name;
    leaveType.code = code !== undefined ? code : leaveType.code;
    leaveType.maxDays = maxDays !== undefined ? maxDays : leaveType.maxDays;
    leaveType.paid = paid !== undefined ? paid : leaveType.paid;
    leaveType.carryForward = carryForward !== undefined ? carryForward : leaveType.carryForward;
    leaveType.isActive = isActive !== undefined ? isActive : leaveType.isActive;

    const updatedLeaveType = await leaveType.save();

    res.status(200).json({ message: "Leave type updated successfully", leaveType: updatedLeaveType });
  } catch (error) {
    console.error("Error updating leave type:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// @desc    Delete a Leave Type
// @route   DELETE /api/leave-types/:id
export const deleteLeaveTypeById = async (req, res) => {
  try {
    const leaveType = await LeaveType.findByIdAndDelete(req.params.id);
    if (!leaveType) {
      return res.status(404).json({ message: "Leave type not found" });
    }

    res.status(200).json({ message: "Leave type deleted successfully" });
  } catch (error) {
    console.error("Error deleting leave type:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};
