/** @format */

import Attendance from "../models/Attendance.js";
import User from "../models/User.js";

/* ================= HELPERS ================= */

const todayDate = () => new Date().toISOString().split("T")[0];

const secondsBetween = (start, end) =>
  Math.floor((end.getTime() - start.getTime()) / 1000);

/* =====================================================
   ✅ PUNCH IN
 ===================================================== */
export const punchIn = async (req, res) => {
  try {
    const userId = req.user._id;
    const date = todayDate();

    const exists = await Attendance.findOne({ user: userId, date });

    if (exists?.punchIn) {
      return res.status(400).json({ message: "Already punched in today" });
    }

    const attendance =
      exists ||
      (await Attendance.create({
        user: userId,
        date,
      }));

    attendance.punchIn = new Date();
    await attendance.save();

    res.json({ message: "Punch in successful", attendance });
  } catch (err) {
    console.error("Punch In Error:", err);
    res.status(500).json({ message: "Punch in failed" });
  }
};

/* =====================================================
   🚪 PUNCH OUT
 ===================================================== */
export const punchOut = async (req, res) => {
  try {
    const userId = req.user._id;
    const date = todayDate();

    const attendance = await Attendance.findOne({ user: userId, date });

    if (!attendance || !attendance.punchIn) {
      return res.status(400).json({ message: "Not punched in yet" });
    }

    if (attendance.punchOut) {
      return res.status(400).json({ message: "Already punched out" });
    }

    attendance.punchOut = new Date();

    const workSeconds = secondsBetween(attendance.punchIn, attendance.punchOut);

    attendance.totalWorkSeconds = workSeconds - attendance.totalBreakSeconds;

    await attendance.save();

    res.json({ message: "Punch out successful", attendance });
  } catch (err) {
    console.error("Punch Out Error:", err);
    res.status(500).json({ message: "Punch out failed" });
  }
};

/* =====================================================
   ☕ START BREAK
 ===================================================== */
export const startBreak = async (req, res) => {
  try {
    const userId = req.user._id;
    const date = todayDate();

    const attendance = await Attendance.findOne({ user: userId, date });

    if (!attendance || !attendance.punchIn || attendance.punchOut) {
      return res.status(400).json({ message: "Break not allowed" });
    }

    const lastBreak =
      attendance.breaks.length > 0
        ? attendance.breaks[attendance.breaks.length - 1]
        : null;
    if (lastBreak && !lastBreak.end) {
      return res.status(400).json({ message: "Break already running" });
    }

    attendance.breaks.push({ start: new Date() });
    await attendance.save();

    res.json({ message: "Break started", attendance });
  } catch (err) {
    console.error("Start Break Error:", err);
    res.status(500).json({ message: "Start break failed" });
  }
};

/* =====================================================
   ▶ END BREAK
 ===================================================== */
export const endBreak = async (req, res) => {
  try {
    const userId = req.user._id;
    const date = todayDate();

    const attendance = await Attendance.findOne({ user: userId, date });

    if (!attendance) {
      return res.status(400).json({ message: "No attendance found" });
    }

    const lastBreak =
      attendance.breaks.length > 0
        ? attendance.breaks[attendance.breaks.length - 1]
        : null;
    if (!lastBreak || lastBreak.end) {
      return res.status(400).json({ message: "No active break" });
    }

    lastBreak.end = new Date();
    lastBreak.duration = secondsBetween(lastBreak.start, lastBreak.end);

    attendance.totalBreakSeconds += lastBreak.duration;
    await attendance.save();

    res.json({ message: "Break ended", attendance });
  } catch (err) {
    console.error("End Break Error:", err);
    res.status(500).json({ message: "End break failed" });
  }
};

/* =====================================================
   📄 GET MY ATTENDANCE
 ===================================================== */
export const getMyAttendance = async (req, res) => {
  try {
    const userId = req.user._id;

    const records = await Attendance.find({ user: userId }).sort({
      date: -1,
    });

    res.json(records);
  } catch (err) {
    console.error("Get My Attendance Error:", err);
    res.status(500).json({ message: "Fetch failed" });
  }
};
/* =====================================================
   📊 GET TEAM ATTENDANCE (MANAGER)
 ===================================================== */
export const getTeamAttendance = async (req, res) => {
  try {
    const managerId = req.user._id;
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({ message: "Month & Year required" });
    }

    // Month from frontend is 0-indexed (0=Jan, 1=Feb)
    const mNum = Number(month) + 1;
    const m = String(mNum).padStart(2, "0");

    // Build correct date range for the selected month
    const startDate = `${year}-${m}-01`;
    const lastDay = new Date(Number(year), mNum, 0).getDate();
    const endDate = `${year}-${m}-${String(lastDay).padStart(2, "0")}`;

    const records = await Attendance.find({
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    }).populate({
      path: "user",
      select: "fullName username role managerId",
      match: { reportingManager: managerId },
    }).lean();

    // remove null users (not in manager's team)
    const filtered = records.filter((r) => r.user).map(r => {
      r.user.name = r.user.fullName || r.user.username || 'Unknown';
      return r;
    });

    return res.json(filtered);
  } catch (err) {
    console.error("Get Team Attendance Error:", err);
    return res.status(500).json({ message: "Failed to load team attendance" });
  }
};

/* =====================================================
   📊 HR / ADMIN – ALL ATTENDANCE
 ===================================================== */
export const getAllAttendance = async (req, res) => {
  try {
    const { month, year, page, limit = 15, search = "" } = req.query;

    const m = Number(month);
    const y = Number(year);

    const startDateStr = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const endDateStr = `${y}-${String(m + 1).padStart(2, "0")}-${new Date(
      y,
      m + 1,
      0,
    ).getDate()}`;

    const todayStr = new Date().toISOString().split("T")[0];

    /* 🔍 SEARCH QUERY */
    const searchQuery = search
      ? {
        $or: [
          { fullName: { $regex: search, $options: "i" } },
          { username: { $regex: search, $options: "i" } },
          { role: { $regex: search, $options: "i" } },
        ],
      }
      : {};

    /* 🔴 CHECK PAGINATION */
    const isPaginated = !!page;
    const pageNum = page ? Number(page) : 1;
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    /* 1️⃣ USERS QUERY */
    const userFilter = { ...searchQuery };
    
    // Filter by companyId if user is not a Super Admin
    if (req.user.role !== 'Super Admin' && req.user.role !== 'Superadmin' && req.user.companyId) {
      userFilter.companyId = req.user.companyId;
    }

    // Filter by reportingManager if user is a Manager
    if (req.user.role === 'Manager') {
      userFilter.reportingManager = req.user._id;
    }

    let usersQuery = User.find(userFilter, "fullName username role").lean();

    if (isPaginated) {
      usersQuery = usersQuery.skip(skip).limit(limitNum);
    }

    const [fetchedUsers, totalUsers] = await Promise.all([
      usersQuery,
      User.countDocuments(userFilter),
    ]);

    const users = fetchedUsers.map(u => ({
      ...u,
      name: u.fullName || u.username || 'Unknown'
    }));

    const userIds = users.map((u) => u._id);

    /* 2️⃣ ATTENDANCE */
    const attendanceRecords = await Attendance.find({
      user: { $in: userIds },
      date: { $gte: startDateStr, $lte: endDateStr },
    })
      .populate("user", "fullName username role")
      .lean();

    const attendance = attendanceRecords.map(a => {
      if (a.user) {
        a.user.name = a.user.fullName || a.user.username || 'Unknown';
      }
      return a;
    });

    /* 3️⃣ TODAY PRESENT */
    const totalTodayPresent = await Attendance.distinct("user", {
      date: todayStr,
      status: "PRESENT",
    }).then((u) => u.length);

    res.json({
      page: isPaginated ? pageNum : null,
      limit: isPaginated ? limitNum : null,
      totalUsers,
      totalPages: isPaginated ? Math.ceil(totalUsers / limitNum) : 1,
      totalTodayPresent,
      users,
      attendance,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch attendance" });
  }
};
