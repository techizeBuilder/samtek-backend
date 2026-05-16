/** @format */

import Resignation from "../models/Resignation.js";
import User from "../models/User.js";

/* ================= EMPLOYEE: CREATE ================= */
export const createResignation = async (req, res) => {
  try {
    const { resignationType, reasonCategory, reasonText, expectedLastWorkingDay, documents } = req.body;

    const resignation = new Resignation({
      employee: req.user._id,
      resignationType,
      reasonCategory,
      reasonText,
      expectedLastWorkingDay,
      documents,
      status: "PENDING",
    });

    await resignation.save();
    res.status(201).json({
      message: "Resignation request submitted successfully",
      resignation,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to submit resignation" });
  }
};

/* ================= EMPLOYEE: GET MY ================= */
export const getMyResignations = async (req, res) => {
  try {
    const data = await Resignation.find({ employee: req.user._id }).sort({
      createdAt: -1,
    });
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch resignations" });
  }
};

/* ================= EMPLOYEE: UPDATE ================= */
export const updateResignation = async (req, res) => {
  try {
    const { id } = req.params;
    const { resignationType, reasonCategory, reasonText, expectedLastWorkingDay, documents } = req.body;

    const resignation = await Resignation.findOne({
      _id: id,
      employee: req.user._id,
      status: "PENDING",
    });

    if (!resignation) {
      return res.status(404).json({ message: "Request not found or already processed" });
    }

    resignation.resignationType = resignationType || resignation.resignationType;
    resignation.reasonCategory = reasonCategory || resignation.reasonCategory;
    resignation.reasonText = reasonText || resignation.reasonText;
    resignation.expectedLastWorkingDay = expectedLastWorkingDay || resignation.expectedLastWorkingDay;
    resignation.documents = documents || resignation.documents;

    await resignation.save();
    res.json({ message: "Resignation request updated successfully", resignation });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update resignation" });
  }
};

/* ================= EMPLOYEE: DELETE ================= */
export const deleteResignation = async (req, res) => {
  try {
    const { id } = req.params;
    const resignation = await Resignation.findOneAndDelete({
      _id: id,
      employee: req.user._id,
      status: "PENDING",
    });

    if (!resignation) {
      return res.status(404).json({ message: "Request not found or already processed" });
    }

    res.json({ message: "Resignation request deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to delete resignation" });
  }
};

/* ================= MANAGER / ADMIN: GET ALL ================= */
export const getAllResignations = async (req, res) => {
  try {
    const fetchedData = await Resignation.find()
      .populate("employee", "fullName username email role")
      .sort({ createdAt: -1 })
      .lean();
    
    const data = fetchedData.map(r => {
      if (r.employee) {
        r.employee.name = r.employee.fullName || r.employee.username || 'Unknown';
      }
      return r;
    });
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch all resignations" });
  }
};

/* ================= MANAGER: GET TEAM ================= */
export const getTeamResignations = async (req, res) => {
  try {
    const managerId = req.user._id;
    const team = await User.find({ reportingManager: managerId }, "_id");
    const teamIds = team.map((u) => u._id);

    const fetchedData = await Resignation.find({ employee: { $in: teamIds } })
      .populate("employee", "fullName username email role")
      .sort({ createdAt: -1 })
      .lean();

    const data = fetchedData.map(r => {
      if (r.employee) {
        r.employee.name = r.employee.fullName || r.employee.username || 'Unknown';
      }
      return r;
    });
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch team resignations" });
  }
};

/* ================= ADMIN / MANAGER: UPDATE STATUS ================= */
export const updateResignationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminRemark } = req.body;

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const resignation = await Resignation.findById(id);
    if (!resignation) {
      return res.status(404).json({ message: "Resignation request not found" });
    }

    resignation.status = status;
    resignation.adminRemark = adminRemark;

    await resignation.save();
    res.json({ message: `Resignation ${status.toLowerCase()} successfully`, resignation });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update resignation status" });
  }
};
