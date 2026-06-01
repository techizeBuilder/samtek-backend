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
exports.getTeamOvertimeRequests = exports.deleteOvertime = exports.updateOvertime = exports.getMyOvertimeRequests = exports.createOvertime = void 0;
const Overtime_js_1 = __importDefault(require("../models/Overtime.js"));
const User_js_1 = __importDefault(require("../models/User.js"));
/* ================= CREATE ================= */
const createOvertime = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const overtime = yield Overtime_js_1.default.create({
            employee: req.user._id,
            date,
            startTime,
            endTime,
            hours: diff,
            reason,
        });
        res.status(201).json(overtime);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to create overtime request" });
    }
});
exports.createOvertime = createOvertime;
/* ================= GET MY REQUESTS ================= */
const getMyOvertimeRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const data = yield Overtime_js_1.default.find({ employee: req.user._id }).sort({
            createdAt: -1,
        });
        res.json(data);
    }
    catch (_a) {
        res.status(500).json({ message: "Failed to fetch overtime requests" });
    }
});
exports.getMyOvertimeRequests = getMyOvertimeRequests;
/* ================= UPDATE ================= */
const updateOvertime = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { date, startTime, endTime, reason, status } = req.body;
        const overtime = yield Overtime_js_1.default.findById(id);
        if (!overtime) {
            return res.status(404).json({
                message: "Overtime request not found",
            });
        }
        /* ================= ROLE BASED LOGIC ================= */
        // 🔹 EMPLOYEE: can edit only when PENDING
        if (req.user.role === "employee") {
            if (overtime.employee.toString() !== req.user._id.toString() ||
                overtime.status !== "PENDING") {
                return res.status(403).json({
                    message: "You are not allowed to update this request",
                });
            }
            if (date)
                overtime.date = date;
            if (startTime)
                overtime.startTime = startTime;
            if (endTime)
                overtime.endTime = endTime;
            if (reason)
                overtime.reason = reason;
            // recalc hours
            const start = new Date(`1970-01-01T${overtime.startTime}`);
            const end = new Date(`1970-01-01T${overtime.endTime}`);
            overtime.hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        }
        // 🔹 MANAGER: can approve / reject
        if (req.user.role === "manager") {
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
            overtime.status = status;
        }
        yield overtime.save();
        res.json({
            message: "Overtime request updated successfully",
            overtime,
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to update overtime request",
        });
    }
});
exports.updateOvertime = updateOvertime;
/* ================= DELETE ================= */
const deleteOvertime = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const deleted = yield Overtime_js_1.default.findOneAndDelete({
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
    }
    catch (_a) {
        res.status(500).json({ message: "Failed to delete overtime request" });
    }
});
exports.deleteOvertime = deleteOvertime;
/* ================= GET TEAM REQUESTS (MANAGER) ================= */
const getTeamOvertimeRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const managerId = req.user._id;
        // 1️⃣ find team members (jinka reportingManager = logged-in manager)
        const teamMembers = yield User_js_1.default.find({ reportingManager: managerId }, "_id fullName username email role");
        const teamIds = teamMembers.map((u) => u._id);
        // 2️⃣ un employees ki overtime requests
        const fetchedRequests = yield Overtime_js_1.default.find({
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
    }
    catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to fetch team overtime requests",
        });
    }
});
exports.getTeamOvertimeRequests = getTeamOvertimeRequests;
