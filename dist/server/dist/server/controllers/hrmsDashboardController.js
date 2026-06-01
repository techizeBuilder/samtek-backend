"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHrmsDashboardStats = void 0;
const User_js_1 = __importDefault(require("../models/User.js"));
const Attendance_js_1 = __importDefault(require("../models/Attendance.js"));
const Payroll_js_1 = __importDefault(require("../models/Payroll.js"));
const JobOpenings_js_1 = __importDefault(require("../models/JobOpenings.js"));
const Holiday_js_1 = __importDefault(require("../models/Holiday.js"));
const getHrmsDashboardStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userCompanyId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.companyId;
        if (!userCompanyId) {
            return res.status(400).json({
                success: false,
                message: "User company association is required to view dashboard."
            });
        }
        // Find all users associated with this company
        const usersInCompany = yield User_js_1.default.find({ companyId: userCompanyId }).select('_id');
        const userIds = usersInCompany.map(u => u._id);
        // 1. Total Employees
        const totalEmployees = yield User_js_1.default.countDocuments({ isActive: true, companyId: userCompanyId });
        // 2. Present Today
        const today = new Date();
        const offset = today.getTimezoneOffset();
        const todayString = new Date(today.getTime() - (offset * 60 * 1000)).toISOString().split('T')[0];
        const presentToday = yield Attendance_js_1.default.countDocuments({
            date: todayString,
            status: "PRESENT",
            user: { $in: userIds }
        });
        // 3. Pending Payroll
        const pendingPayroll = yield Payroll_js_1.default.countDocuments({
            status: "Draft",
            employee: { $in: userIds }
        });
        // 4. Open Jobs
        // JobOpening schema does not have companyId directly, so we filter by recruitingManager belonging to the company
        const openJobs = yield JobOpenings_js_1.default.countDocuments({
            status: "Open",
            recruitingManager: { $in: userIds }
        });
        // 5. Recent Attendance
        const recentAttendance = yield Attendance_js_1.default.find({
            date: todayString,
            user: { $in: userIds }
        })
            .populate("user", "fullName employeeId profilePicture")
            .sort({ createdAt: -1 })
            .limit(5);
        // 6. Upcoming Holidays
        const upcomingHolidays = yield Holiday_js_1.default.find({
            date: { $gte: new Date() },
            isActive: true,
            $or: [
                { companyId: userCompanyId },
                { companyId: { $exists: false } },
                { companyId: null }
            ]
        })
            .sort({ date: 1 })
            .limit(5);
        res.status(200).json({
            success: true,
            data: {
                totalEmployees,
                presentToday,
                pendingPayroll,
                openJobs,
                recentAttendance,
                upcomingHolidays
            }
        });
    }
    catch (error) {
        console.error("Error fetching HRMS dashboard stats:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch HRMS dashboard stats",
            error: error.message
        });
    }
});
exports.getHrmsDashboardStats = getHrmsDashboardStats;
