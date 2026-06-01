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
exports.getAllEmployeesLeaveRequests = exports.updateLeaveStatus = exports.getAllLeaveRequests = exports.getTodayTeamLeaves = exports.deleteLeave = exports.updateLeave = exports.getMyLeaves = exports.applyLeave = void 0;
const Leave_js_1 = __importDefault(require("../models/Leave.js"));
const LeaveType_js_1 = __importDefault(require("../models/LeaveType.js"));
const LeaveBalanceAdjustment_js_1 = __importDefault(require("../models/LeaveBalanceAdjustment.js"));
const User_js_1 = __importDefault(require("../models/User.js"));
const email_js_1 = require("../utils/email.js");
const mongoose_1 = __importDefault(require("mongoose"));
// ================= HELPER =================
const calculateDays = (from, to) => {
    const diff = new Date(to).getTime() - new Date(from).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
};
// ================= APPLY LEAVE =================
const applyLeave = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { leaveType, fromDate, toDate, reason } = req.body;
        if (!leaveType || !fromDate || !toDate || !reason) {
            return res.status(400).json({ message: "All fields are required" });
        }
        // 🔹 calculate requested days
        const totalDays = calculateDays(fromDate, toDate);
        if (totalDays <= 0) {
            return res.status(400).json({ message: "Invalid leave duration" });
        }
        // 🔹 get leave type config
        const leaveTypeDoc = yield LeaveType_js_1.default.findOne({ name: leaveType });
        if (!leaveTypeDoc) {
            return res.status(400).json({ message: "Invalid leave type" });
        }
        const empObjectId = new mongoose_1.default.Types.ObjectId(req.user._id);
        // 🔹 calculate used leaves (APPROVED only)
        const usedAgg = yield Leave_js_1.default.aggregate([
            {
                $match: {
                    employee: empObjectId,
                    leaveType,
                    status: "APPROVED",
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$totalDays" },
                },
            },
        ]);
        const usedLeaves = ((_a = usedAgg[0]) === null || _a === void 0 ? void 0 : _a.total) || 0;
        // 🔹 calculate sum of manual adjustments
        const adjAgg = yield LeaveBalanceAdjustment_js_1.default.aggregate([
            {
                $match: {
                    employee: empObjectId,
                    leaveType,
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$adjustment" },
                },
            },
        ]);
        const totalAdjustments = ((_b = adjAgg[0]) === null || _b === void 0 ? void 0 : _b.total) || 0;
        const remainingLeaves = leaveTypeDoc.maxDays + totalAdjustments - usedLeaves;
        // 🔹 validation
        if (totalDays > remainingLeaves) {
            return res.status(400).json({
                message: `Only ${remainingLeaves} leave(s) remaining for ${leaveType}`,
            });
        }
        // 🔹 create leave (NO remainingLeaves saved)
        const leave = yield Leave_js_1.default.create({
            employee: req.user._id,
            leaveType,
            fromDate,
            toDate,
            totalDays,
            reason,
            status: "PENDING",
        });
        res.status(201).json(leave);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to apply leave" });
    }
});
exports.applyLeave = applyLeave;
// ================= GET MY LEAVES =================
const getMyLeaves = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leaves = yield Leave_js_1.default.find({
            employee: req.user._id,
        }).sort({ createdAt: -1 });
        res.json(leaves);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to fetch leaves" });
    }
});
exports.getMyLeaves = getMyLeaves;
// ================= UPDATE LEAVE =================
const updateLeave = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { leaveType, fromDate, toDate, reason } = req.body;
        const leave = yield Leave_js_1.default.findOne({
            _id: req.params.id,
            employee: req.user._id,
        });
        if (!leave) {
            return res.status(404).json({ message: "Leave not found" });
        }
        if (leave.status !== "PENDING") {
            return res
                .status(400)
                .json({ message: "Approved / Rejected leave can't be edited" });
        }
        const totalDays = calculateDays(fromDate, toDate);
        const leaveTypeDoc = yield LeaveType_js_1.default.findOne({ name: leaveType });
        if (!leaveTypeDoc) {
            return res.status(400).json({ message: "Invalid leave type" });
        }
        const empObjectId = new mongoose_1.default.Types.ObjectId(req.user._id);
        const usedAgg = yield Leave_js_1.default.aggregate([
            {
                $match: {
                    employee: empObjectId,
                    leaveType,
                    status: "APPROVED",
                    _id: { $ne: leave._id },
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$totalDays" },
                },
            },
        ]);
        const usedLeaves = ((_a = usedAgg[0]) === null || _a === void 0 ? void 0 : _a.total) || 0;
        // 🔹 calculate sum of manual adjustments
        const adjAgg = yield LeaveBalanceAdjustment_js_1.default.aggregate([
            {
                $match: {
                    employee: empObjectId,
                    leaveType,
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$adjustment" },
                },
            },
        ]);
        const totalAdjustments = ((_b = adjAgg[0]) === null || _b === void 0 ? void 0 : _b.total) || 0;
        const remainingLeaves = leaveTypeDoc.maxDays + totalAdjustments - usedLeaves;
        if (totalDays > remainingLeaves) {
            return res.status(400).json({
                message: `Only ${remainingLeaves} leave(s) remaining for ${leaveType}`,
            });
        }
        leave.leaveType = leaveType;
        leave.fromDate = fromDate;
        leave.toDate = toDate;
        leave.totalDays = totalDays;
        leave.reason = reason;
        yield leave.save();
        res.json(leave);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update leave" });
    }
});
exports.updateLeave = updateLeave;
// ================= DELETE LEAVE =================
const deleteLeave = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leave = yield Leave_js_1.default.findOneAndDelete({
            _id: req.params.id,
            employee: req.user._id,
            status: "PENDING",
        });
        if (!leave) {
            return res
                .status(404)
                .json({ message: "Leave not found or can't be deleted" });
        }
        res.json({ message: "Leave deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to delete leave" });
    }
});
exports.deleteLeave = deleteLeave;
const getTodayTeamLeaves = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const managerId = req.user._id;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const leaves = yield Leave_js_1.default.find({
            status: "APPROVED",
            fromDate: { $lte: today },
            toDate: { $gte: today },
        })
            .populate({
            path: "employee",
            select: "fullName role email reportingManager username",
            match: { reportingManager: managerId }, // ✅ sirf is manager ki team
        })
            .sort({ fromDate: 1 })
            .lean();
        // ❗ populate ke baad null employees hata do
        const filteredLeaves = leaves.filter((leave) => leave.employee).map(l => {
            if (l.employee) {
                l.employee.name = l.employee.fullName || l.employee.username || 'Unknown';
            }
            return l;
        });
        res.json(filteredLeaves);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to fetch today team leaves",
        });
    }
});
exports.getTodayTeamLeaves = getTodayTeamLeaves;
const getAllLeaveRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const managerId = req.user._id;
        // 🔹 Step 1: manager ke under ke employees
        const teamEmployees = yield User_js_1.default.find({ reportingManager: managerId }, "_id");
        const employeeIds = teamEmployees.map((e) => e._id);
        // 🔹 Step 2: un employees ki leave requests
        const fetchedLeaves = yield Leave_js_1.default.find({
            employee: { $in: employeeIds },
        })
            .populate("employee", "fullName username email role")
            .sort({ createdAt: -1 })
            .lean();
        const leaves = fetchedLeaves.map(l => {
            if (l.employee) {
                l.employee.name = l.employee.fullName || l.employee.username || 'Unknown';
            }
            return l;
        });
        res.status(200).json(leaves);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to fetch leave requests",
        });
    }
});
exports.getAllLeaveRequests = getAllLeaveRequests;
/* ================= UPDATE LEAVE STATUS ================= */
const updateLeaveStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, remark } = req.body;
        const { id } = req.params;
        if (!["APPROVED", "REJECTED"].includes(status)) {
            return res.status(400).json({ message: "Invalid status" });
        }
        const leave = yield Leave_js_1.default.findByIdAndUpdate(id, { status, remark }, { new: true }).populate("employee", "fullName email");
        if (!leave || !leave.employee) {
            return res.status(404).json({ message: "Leave not found" });
        }
        const employee = leave.employee;
        // 📧 SEND EMAIL
        yield (0, email_js_1.sendCommonEmail)({
            type: status === "APPROVED"
                ? email_js_1.CommonEmailType.LEAVE_APPROVED
                : email_js_1.CommonEmailType.LEAVE_REJECTED,
            to: employee.email,
            name: employee.name,
            data: {
                from: leave.fromDate,
                to: leave.toDate,
                remark,
            },
        });
        res.status(200).json(leave);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to update leave status" });
    }
});
exports.updateLeaveStatus = updateLeaveStatus;
// ================= GET ALL EMPLOYEES LEAVE REQUESTS (HR / ADMIN) =================
const getAllEmployeesLeaveRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const filter = {};
        // If user is not a global Super Admin, filter by their company
        if (req.user.role !== 'Super Admin' && req.user.role !== 'Superadmin' && req.user.companyId) {
            // Find all users in the same company
            const usersInCompany = yield User_js_1.default.find({ companyId: req.user.companyId }, "_id");
            const userIds = usersInCompany.map(u => u._id);
            filter.employee = { $in: userIds };
        }
        const fetchedLeaves = yield Leave_js_1.default.find(filter)
            .populate("employee", "fullName username email role")
            .sort({ createdAt: -1 })
            .lean();
        const leaves = fetchedLeaves.map(l => {
            if (l.employee) {
                l.employee.name = l.employee.fullName || l.employee.username || 'Unknown';
            }
            return l;
        });
        res.status(200).json(leaves);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to fetch leave requests",
        });
    }
});
exports.getAllEmployeesLeaveRequests = getAllEmployeesLeaveRequests;
