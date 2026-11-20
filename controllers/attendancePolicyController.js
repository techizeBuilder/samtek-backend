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
      weeklyOffDays,
      shifts,
    } = req.body;

    // Shifts (2026-11-12): name, start, end, lunch from–to, all HH:MM. Lunch must
    // fall inside the shift; an end before the start crosses midnight.
    let cleanShifts;
    if (shifts !== undefined) {
      const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
      const min = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      const mod = (n) => ((n % 1440) + 1440) % 1440;
      if (!Array.isArray(shifts) || shifts.length > 10) return res.status(400).json({ message: "Shifts must be a list of up to 10" });
      const names = new Set();
      cleanShifts = [];
      for (const s of shifts) {
        const name = String(s?.name || "").trim();
        if (!name) return res.status(400).json({ message: "Each shift needs a name" });
        if (names.has(name.toLowerCase())) return res.status(400).json({ message: `Two shifts are called "${name}"` });
        names.add(name.toLowerCase());
        for (const f of ["start", "end", "lunchFrom", "lunchTo"]) {
          if (!HHMM.test(String(s?.[f] || ""))) return res.status(400).json({ message: `${name}: times must look like 09:00 (start, end, lunch from and to)` });
        }
        if (s.start === s.end) return res.status(400).json({ message: `${name}: start and end can't be the same` });
        const length = mod(min(s.end) - min(s.start));
        const lunchAt = mod(min(s.lunchFrom) - min(s.start));
        const lunchLen = mod(min(s.lunchTo) - min(s.lunchFrom));
        if (!lunchLen || lunchAt + lunchLen > length) return res.status(400).json({ message: `${name}: lunch must fall inside the shift` });
        cleanShifts.push({ name, start: s.start, end: s.end, lunchFrom: s.lunchFrom, lunchTo: s.lunchTo });
      }
    }

    // 0 = Sunday … 6 = Saturday; none at all is allowed (2026-11-11).
    if (weeklyOffDays !== undefined) {
      const ok = Array.isArray(weeklyOffDays) && weeklyOffDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        && new Set(weeklyOffDays).size === weeklyOffDays.length && weeklyOffDays.length < 7;
      if (!ok) return res.status(400).json({ message: "Weekly off must be days of the week, each once, and not all seven" });
    }

    const updateData = {};
    if (graceTime !== undefined) updateData.graceTime = graceTime;
    if (lateAfter !== undefined) updateData.lateAfter = lateAfter;
    if (lateCountHalfDay !== undefined) updateData.lateCountHalfDay = lateCountHalfDay;
    if (earlyExitMinutes !== undefined) updateData.earlyExitMinutes = earlyExitMinutes;
    if (overtimeEnabled !== undefined) updateData.overtimeEnabled = overtimeEnabled;
    if (overtimeAfter !== undefined) updateData.overtimeAfter = overtimeAfter;
    if (overtimeType !== undefined) updateData.overtimeType = overtimeType;
    if (weeklyOffDays !== undefined) updateData.weeklyOffDays = [...weeklyOffDays].sort((a, b) => a - b);
    if (cleanShifts !== undefined) updateData.shifts = cleanShifts;

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
