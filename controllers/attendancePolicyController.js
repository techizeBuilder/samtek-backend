/** @format */
import { AttendancePolicy } from "../models/AttendancePolicy.js";

const DEFAULTS = {
  graceTime: 10,
  lateAfter: 15,
  lateCountHalfDay: 3,
  earlyExitMinutes: 30,
  overtimeEnabled: true,
  overtimeAfter: 8,
  overtimeType: "Paid",
};

const resolveCompanyId = (req) =>
  ["Super Admin", "Superadmin"].includes(req.user.role)
    ? req.query.companyId || req.body?.companyId || null
    : req.user.companyId || null;

// @desc Get (or lazily create with defaults) the company's attendance policy
export const getAttendancePolicy = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);

    // Atomic upsert avoids the classic "two requests both find nothing, both
    // try to create" duplicate-key race.
    const policy = await AttendancePolicy.findOneAndUpdate(
      { companyId },
      { $setOnInsert: { companyId, ...DEFAULTS } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json(policy);
  } catch (err) {
    res.status(500).json({ message: "Error fetching attendance policy", error: err.message });
  }
};

// @desc Update the company's attendance policy
export const updateAttendancePolicy = async (req, res) => {
  try {
    if (!["HR-Admin", "Hr Admin", "Superadmin", "Super Admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied. Only HR-Admin can edit the attendance policy." });
    }

    const companyId = resolveCompanyId(req);

    const {
      graceTime,
      lateAfter,
      lateCountHalfDay,
      earlyExitMinutes,
      overtimeEnabled,
      overtimeAfter,
      overtimeType,
    } = req.body;

    const updateData = {};
    if (graceTime !== undefined) updateData.graceTime = graceTime;
    if (lateAfter !== undefined) updateData.lateAfter = lateAfter;
    if (lateCountHalfDay !== undefined) updateData.lateCountHalfDay = lateCountHalfDay;
    if (earlyExitMinutes !== undefined) updateData.earlyExitMinutes = earlyExitMinutes;
    if (overtimeEnabled !== undefined) updateData.overtimeEnabled = overtimeEnabled;
    if (overtimeAfter !== undefined) updateData.overtimeAfter = overtimeAfter;
    if (overtimeType !== undefined) updateData.overtimeType = overtimeType;

    const policy = await AttendancePolicy.findOneAndUpdate(
      { companyId },
      { $set: updateData, $setOnInsert: { companyId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ message: "Attendance policy updated successfully", policy });
  } catch (err) {
    res.status(500).json({ message: "Error updating attendance policy", error: err.message });
  }
};
