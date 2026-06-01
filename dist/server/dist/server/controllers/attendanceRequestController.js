"use strict";
/** @format */
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
exports.getAllAttendanceRequests = exports.updateAttendanceRequestStatus = exports.getTeamAttendanceRequests = exports.deleteAttendanceRequest = exports.updateAttendanceRequest = exports.getMyAttendanceRequests = exports.createAttendanceRequest = void 0;
const AttendanceRequest_js_1 = __importDefault(require("../models/AttendanceRequest.js"));
const Attendance_js_1 = __importDefault(require("../models/Attendance.js"));
const User_js_1 = __importDefault(require("../models/User.js"));
/* ================= EMPLOYEE: CREATE REQUEST ================= */
const createAttendanceRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { date, type, punchIn, punchOut, reason } = req.body;
        const userId = req.user._id;
        const request = new AttendanceRequest_js_1.default({
            user: userId,
            date,
            type,
            punchIn,
            punchOut,
            reason,
            status: "PENDING",
        });
        yield request.save();
        res.status(201).json({
            message: "Attendance request submitted successfully",
            request,
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to submit attendance request" });
    }
});
exports.createAttendanceRequest = createAttendanceRequest;
/* ================= EMPLOYEE: GET MY REQUESTS ================= */
const getMyAttendanceRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const requests = yield AttendanceRequest_js_1.default.find({ user: req.user._id }).sort({
            createdAt: -1,
        });
        res.json(requests);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch attendance requests" });
    }
});
exports.getMyAttendanceRequests = getMyAttendanceRequests;
/* ================= EMPLOYEE: UPDATE REQUEST ================= */
const updateAttendanceRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { date, type, punchIn, punchOut, reason } = req.body;
        const request = yield AttendanceRequest_js_1.default.findOne({
            _id: id,
            user: req.user._id,
        });
        if (!request) {
            return res.status(404).json({ message: "Request not found" });
        }
        if (request.status !== "PENDING") {
            return res
                .status(400)
                .json({ message: "Cannot update processed request" });
        }
        request.date = date || request.date;
        request.type = type || request.type;
        request.punchIn = punchIn || request.punchIn;
        request.punchOut = punchOut || request.punchOut;
        request.reason = reason || request.reason;
        yield request.save();
        res.json({ message: "Attendance request updated successfully", request });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to update attendance request" });
    }
});
exports.updateAttendanceRequest = updateAttendanceRequest;
/* ================= EMPLOYEE: DELETE REQUEST ================= */
const deleteAttendanceRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const request = yield AttendanceRequest_js_1.default.findOneAndDelete({
            _id: id,
            user: req.user._id,
            status: "PENDING",
        });
        if (!request) {
            return res
                .status(404)
                .json({ message: "Request not found or already processed" });
        }
        res.json({ message: "Attendance request deleted successfully" });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to delete attendance request" });
    }
});
exports.deleteAttendanceRequest = deleteAttendanceRequest;
/* ================= MANAGER: GET TEAM REQUESTS ================= */
const getTeamAttendanceRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const managerId = req.user._id;
        // 1️⃣ Get team members
        const teamMembers = yield User_js_1.default.find({ reportingManager: managerId }, "_id fullName username email role");
        const teamIds = teamMembers.map((u) => u._id);
        // 2️⃣ Get attendance requests for those members
        const fetchedRequests = yield AttendanceRequest_js_1.default.find({
            user: { $in: teamIds },
        })
            .populate("user", "fullName username email role")
            .sort({ createdAt: -1 })
            .lean();
        const requests = fetchedRequests.map(r => {
            if (r.user) {
                r.user.name = r.user.fullName || r.user.username || 'Unknown';
            }
            return r;
        });
        res.json(requests);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to fetch team attendance requests",
        });
    }
});
exports.getTeamAttendanceRequests = getTeamAttendanceRequests;
/* ================= MANAGER: UPDATE STATUS ================= */
const updateAttendanceRequestStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, adminRemark } = req.body;
        const { id } = req.params;
        if (!["APPROVED", "REJECTED"].includes(status)) {
            return res.status(400).json({ message: "Invalid status" });
        }
        const request = yield AttendanceRequest_js_1.default.findById(id);
        if (!request) {
            return res.status(404).json({ message: "Attendance request not found" });
        }
        if (request.status !== "PENDING") {
            return res.status(400).json({ message: "Request already processed" });
        }
        request.status = status;
        request.adminRemark = adminRemark;
        /* 🔄 IF APPROVED, UPDATE ACTUAL ATTENDANCE 🔄 */
        if (status === "APPROVED") {
            const { user, date, punchIn, punchOut } = request;
            // Update or Create actual attendance record
            yield Attendance_js_1.default.findOneAndUpdate({ user, date }, {
                punchIn: punchIn ? new Date(`${date}T${punchIn}`) : undefined,
                punchOut: punchOut ? new Date(`${date}T${punchOut}`) : undefined,
                status: "PRESENT",
            }, { upsert: true, new: true });
        }
        yield request.save();
        res.json(request);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to update attendance request status",
        });
    }
});
exports.updateAttendanceRequestStatus = updateAttendanceRequestStatus;
/* ================= ADMIN / HR: GET ALL REQUESTS ================= */
const getAllAttendanceRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const filter = {};
        // If user is not a global Super Admin, filter by their company
        if (req.user.role !== 'Super Admin' && req.user.role !== 'Superadmin' && req.user.companyId) {
            // Find all users in the same company
            const usersInCompany = yield User_js_1.default.find({ companyId: req.user.companyId }, "_id");
            const userIds = usersInCompany.map(u => u._id);
            filter.user = { $in: userIds };
        }
        const fetchedRequests = yield AttendanceRequest_js_1.default.find(filter)
            .populate("user", "fullName username email role")
            .sort({ createdAt: -1 })
            .lean();
        const requests = fetchedRequests.map(r => {
            if (r.user) {
                r.user.name = r.user.fullName || r.user.username || 'Unknown';
            }
            return r;
        });
        res.json(requests);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to fetch attendance requests",
        });
    }
});
exports.getAllAttendanceRequests = getAllAttendanceRequests;
