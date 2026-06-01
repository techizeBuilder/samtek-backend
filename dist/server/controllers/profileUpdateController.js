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
exports.getTeamProfileUpdateRequests = exports.deleteProfileUpdate = exports.updateProfileUpdate = exports.getMyProfileUpdates = exports.createProfileUpdate = void 0;
const ProfileUpdate_js_1 = __importDefault(require("../models/ProfileUpdate.js"));
const User_js_1 = __importDefault(require("../models/User.js"));
/* ================= CREATE ================= */
const createProfileUpdate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { updateType, newValue, reason } = req.body;
        if (!updateType || !newValue || !reason) {
            return res.status(400).json({
                message: "All fields are required",
            });
        }
        const request = yield ProfileUpdate_js_1.default.create({
            employee: req.user._id,
            updateType,
            newValue,
            reason,
        });
        res.status(201).json(request);
    }
    catch (err) {
        res.status(500).json({
            message: err.message || "Failed to create profile update request",
        });
    }
});
exports.createProfileUpdate = createProfileUpdate;
/* ================= GET MY REQUESTS ================= */
const getMyProfileUpdates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const requests = yield ProfileUpdate_js_1.default.find({
            employee: req.user._id,
        }).sort({ createdAt: -1 });
        res.json(requests);
    }
    catch (_a) {
        res.status(500).json({ message: "Failed to fetch requests" });
    }
});
exports.getMyProfileUpdates = getMyProfileUpdates;
/* ================= UPDATE (EDIT) ================= */
const updateProfileUpdate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { updateType, newValue, reason, status } = req.body;
        const requestId = req.params.id;
        const request = yield ProfileUpdate_js_1.default.findById(requestId);
        if (!request) {
            return res.status(404).json({
                message: "Profile update request not found",
            });
        }
        /* ================= EMPLOYEE EDIT ================= */
        if (status === undefined) {
            // only owner can edit & only PENDING
            if (request.employee.toString() !== req.user._id ||
                request.status !== "PENDING") {
                return res.status(403).json({
                    message: "You are not allowed to edit this request",
                });
            }
            if (!updateType || !newValue || !reason) {
                return res.status(400).json({
                    message: "All fields are required",
                });
            }
            request.updateType = updateType;
            request.newValue = newValue;
            request.reason = reason;
            yield request.save();
            return res.json(request);
        }
        /* ================= MANAGER / HR STATUS UPDATE ================= */
        if (!["APPROVED", "REJECTED"].includes(status)) {
            return res.status(400).json({
                message: "Invalid status value",
            });
        }
        if (request.status !== "PENDING") {
            return res.status(400).json({
                message: "Request already processed",
            });
        }
        request.status = status;
        /* ================= APPLY PROFILE CHANGE ON APPROVE ================= */
        if (status === "APPROVED") {
            yield User_js_1.default.findByIdAndUpdate(request.employee, {
                [request.updateType]: request.newValue,
            });
        }
        yield request.save();
        res.json(request);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to update profile request",
        });
    }
});
exports.updateProfileUpdate = updateProfileUpdate;
/* ================= DELETE ================= */
const deleteProfileUpdate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const request = yield ProfileUpdate_js_1.default.findOneAndDelete({
            _id: req.params.id,
            employee: req.user._id,
            status: "PENDING",
        });
        if (!request) {
            return res.status(404).json({
                message: "Request not found or cannot be deleted",
            });
        }
        res.json({ message: "Profile update request deleted successfully" });
    }
    catch (_a) {
        res.status(500).json({ message: "Failed to delete request" });
    }
});
exports.deleteProfileUpdate = deleteProfileUpdate;
const getTeamProfileUpdateRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const managerId = req.user._id;
        // 1️⃣ find employees under this manager
        const teamMembers = yield User_js_1.default.find({ reportingManager: managerId }, "_id fullName username email role");
        const teamIds = teamMembers.map((u) => u._id);
        // 2️⃣ fetch profile update requests of those employees
        const fetchedRequests = yield ProfileUpdate_js_1.default.find({
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
            message: "Failed to fetch team profile update requests",
        });
    }
});
exports.getTeamProfileUpdateRequests = getTeamProfileUpdateRequests;
