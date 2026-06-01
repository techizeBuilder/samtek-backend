"use strict";
/** @format */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllAttendance = exports.getTeamAttendance = exports.getMyAttendance = exports.endBreak = exports.startBreak = exports.punchOut = exports.punchIn = void 0;
const Attendance_js_1 = __importDefault(require("../models/Attendance.js"));
const User_js_1 = __importDefault(require("../models/User.js"));
/* ================= HELPERS ================= */
const todayDate = () => new Date().toISOString().split("T")[0];
const secondsBetween = (start, end) => Math.floor((end.getTime() - start.getTime()) / 1000);
/* =====================================================
   ✅ PUNCH IN
 ===================================================== */
const punchIn = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user._id;
        const date = todayDate();
        const exists = yield Attendance_js_1.default.findOne({ user: userId, date });
        if (exists === null || exists === void 0 ? void 0 : exists.punchIn) {
            return res.status(400).json({ message: "Already punched in today" });
        }
        const attendance = exists ||
            (yield Attendance_js_1.default.create({
                user: userId,
                date,
            }));
        attendance.punchIn = new Date();
        yield attendance.save();
        res.json({ message: "Punch in successful", attendance });
    }
    catch (err) {
        console.error("Punch In Error:", err);
        res.status(500).json({ message: "Punch in failed" });
    }
});
exports.punchIn = punchIn;
/* =====================================================
   🚪 PUNCH OUT
 ===================================================== */
const punchOut = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user._id;
        const date = todayDate();
        const attendance = yield Attendance_js_1.default.findOne({ user: userId, date });
        if (!attendance || !attendance.punchIn) {
            return res.status(400).json({ message: "Not punched in yet" });
        }
        if (attendance.punchOut) {
            return res.status(400).json({ message: "Already punched out" });
        }
        attendance.punchOut = new Date();
        const workSeconds = secondsBetween(attendance.punchIn, attendance.punchOut);
        attendance.totalWorkSeconds = workSeconds - attendance.totalBreakSeconds;
        yield attendance.save();
        res.json({ message: "Punch out successful", attendance });
    }
    catch (err) {
        console.error("Punch Out Error:", err);
        res.status(500).json({ message: "Punch out failed" });
    }
});
exports.punchOut = punchOut;
/* =====================================================
   ☕ START BREAK
 ===================================================== */
const startBreak = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user._id;
        const date = todayDate();
        const attendance = yield Attendance_js_1.default.findOne({ user: userId, date });
        if (!attendance || !attendance.punchIn || attendance.punchOut) {
            return res.status(400).json({ message: "Break not allowed" });
        }
        const lastBreak = attendance.breaks.length > 0
            ? attendance.breaks[attendance.breaks.length - 1]
            : null;
        if (lastBreak && !lastBreak.end) {
            return res.status(400).json({ message: "Break already running" });
        }
        attendance.breaks.push({ start: new Date() });
        yield attendance.save();
        res.json({ message: "Break started", attendance });
    }
    catch (err) {
        console.error("Start Break Error:", err);
        res.status(500).json({ message: "Start break failed" });
    }
});
exports.startBreak = startBreak;
/* =====================================================
   ▶ END BREAK
 ===================================================== */
const endBreak = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user._id;
        const date = todayDate();
        const attendance = yield Attendance_js_1.default.findOne({ user: userId, date });
        if (!attendance) {
            return res.status(400).json({ message: "No attendance found" });
        }
        const lastBreak = attendance.breaks.length > 0
            ? attendance.breaks[attendance.breaks.length - 1]
            : null;
        if (!lastBreak || lastBreak.end) {
            return res.status(400).json({ message: "No active break" });
        }
        lastBreak.end = new Date();
        lastBreak.duration = secondsBetween(lastBreak.start, lastBreak.end);
        attendance.totalBreakSeconds += lastBreak.duration;
        yield attendance.save();
        res.json({ message: "Break ended", attendance });
    }
    catch (err) {
        console.error("End Break Error:", err);
        res.status(500).json({ message: "End break failed" });
    }
});
exports.endBreak = endBreak;
/* =====================================================
   📄 GET MY ATTENDANCE
 ===================================================== */
const getMyAttendance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user._id;
        const records = yield Attendance_js_1.default.find({ user: userId }).sort({
            date: -1,
        });
        res.json(records);
    }
    catch (err) {
        console.error("Get My Attendance Error:", err);
        res.status(500).json({ message: "Fetch failed" });
    }
});
exports.getMyAttendance = getMyAttendance;
/* =====================================================
   📊 GET TEAM ATTENDANCE (MANAGER)
 ===================================================== */
const getTeamAttendance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const records = yield Attendance_js_1.default.find({
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
    }
    catch (err) {
        console.error("Get Team Attendance Error:", err);
        return res.status(500).json({ message: "Failed to load team attendance" });
    }
});
exports.getTeamAttendance = getTeamAttendance;
/* =====================================================
   📊 HR / ADMIN – ALL ATTENDANCE
 ===================================================== */
const getAllAttendance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { month, year, page, limit = 15, search = "" } = req.query;
        const m = Number(month);
        const y = Number(year);
        const startDateStr = `${y}-${String(m + 1).padStart(2, "0")}-01`;
        const endDateStr = `${y}-${String(m + 1).padStart(2, "0")}-${new Date(y, m + 1, 0).getDate()}`;
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
        const userFilter = Object.assign({}, searchQuery);
        // Filter by companyId if user is not a Super Admin
        if (req.user.role !== 'Superadmin' && req.user.companyId) {
            userFilter.companyId = req.user.companyId;
        }
        // Filter by reportingManager if user is a Manager
        if (req.user.role === 'Manager') {
            userFilter.reportingManager = req.user._id;
        }
        let usersQuery = User_js_1.default.find(userFilter, "fullName username role").lean();
        if (isPaginated) {
            usersQuery = usersQuery.skip(skip).limit(limitNum);
        }
        const [fetchedUsers, totalUsers] = yield Promise.all([
            usersQuery,
            User_js_1.default.countDocuments(userFilter),
        ]);
        const users = fetchedUsers.map(u => (Object.assign(Object.assign({}, u), { name: u.fullName || u.username || 'Unknown' })));
        const userIds = users.map((u) => u._id);
        /* 2️⃣ ATTENDANCE */
        const attendanceRecords = yield Attendance_js_1.default.find({
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
        const totalTodayPresent = yield Attendance_js_1.default.distinct("user", {
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
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch attendance" });
    }
});
exports.getAllAttendance = getAllAttendance;
