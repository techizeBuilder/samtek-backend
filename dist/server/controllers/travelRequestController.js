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
exports.uploadTravelReceipt = exports.updateManagerTravelStatus = exports.getManagerTravelRequests = exports.updateTravelRequestStatus = exports.deleteTravelRequest = exports.updateTravelRequest = exports.getAllTravelRequests = exports.getMyTravelRequests = exports.createTravelRequest = void 0;
const TravelRequest_js_1 = __importDefault(require("../models/TravelRequest.js"));
const User_js_1 = __importDefault(require("../models/User.js"));
/* ================= CREATE ================= */
const createTravelRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { purpose, destination, fromDate, toDate, budget, remarks } = req.body;
        const request = yield TravelRequest_js_1.default.create({
            employee: req.user._id,
            purpose,
            destination,
            fromDate,
            toDate,
            budget,
            remarks,
            // 👇 initially finance fields empty
            payable: undefined,
            paymentStatus: "UNPAID",
            // 👇 if receipt uploaded
            receiptUrl: req.file ? `/uploads/travel/${req.file.filename}` : undefined,
            status: "PENDING",
        });
        res.status(201).json(request);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to create travel request",
        });
    }
});
exports.createTravelRequest = createTravelRequest;
/* ================= GET MY REQUESTS (EMPLOYEE) ================= */
const getMyTravelRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const requests = yield TravelRequest_js_1.default.find({
            employee: req.user._id,
        }).sort({ createdAt: -1 });
        res.json(requests);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to fetch travel requests" });
    }
});
exports.getMyTravelRequests = getMyTravelRequests;
/* ================= GET ALL (HR / ADMIN) ================= */
const getAllTravelRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const fetchedRequests = yield TravelRequest_js_1.default.find()
            .populate("employee", "fullName username email")
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
        res.status(500).json({ message: "Failed to fetch requests" });
    }
});
exports.getAllTravelRequests = getAllTravelRequests;
/* ================= UPDATE (VIEW / EDIT) ================= */
const updateTravelRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const request = yield TravelRequest_js_1.default.findOneAndUpdate({
            _id: req.params.id,
        }, req.body, { new: true });
        if (!request) {
            return res.status(404).json({ message: "Request not found" });
        }
        res.json(request);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update request" });
    }
});
exports.updateTravelRequest = updateTravelRequest;
/* ================= DELETE ================= */
const deleteTravelRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const request = yield TravelRequest_js_1.default.findOneAndDelete({
            _id: req.params.id,
            employee: req.user._id,
        });
        if (!request) {
            return res.status(404).json({ message: "Request not found" });
        }
        res.json({ message: "Travel request deleted" });
    }
    catch (error) {
        res.status(500).json({ message: "Failed to delete request" });
    }
});
exports.deleteTravelRequest = deleteTravelRequest;
/* ================= APPROVE / REJECT (HR) ================= */
const updateTravelRequestStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status } = req.body;
        const request = yield TravelRequest_js_1.default.findByIdAndUpdate(req.params.id, { status }, { new: true });
        if (!request) {
            return res.status(404).json({ message: "Request not found" });
        }
        res.json(request);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update status" });
    }
});
exports.updateTravelRequestStatus = updateTravelRequestStatus;
const getManagerTravelRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const managerId = req.user._id;
        const team = yield User_js_1.default.find({ reportingManager: managerId }, "_id");
        const employeeIds = team.map((u) => u._id);
        const fetchedRequests = yield TravelRequest_js_1.default.find({
            employee: { $in: employeeIds },
        })
            .populate("employee", "fullName username email")
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
        res.status(500).json({
            message: "Failed to fetch manager travel requests",
        });
    }
});
exports.getManagerTravelRequests = getManagerTravelRequests;
const updateManagerTravelStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status } = req.body;
        if (!["APPROVED", "REJECTED"].includes(status)) {
            return res.status(400).json({ message: "Invalid status" });
        }
        const request = yield TravelRequest_js_1.default.findByIdAndUpdate(req.params.id, { status }, { new: true });
        if (!request) {
            return res.status(404).json({ message: "Request not found" });
        }
        res.json(request);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update status" });
    }
});
exports.updateManagerTravelStatus = updateManagerTravelStatus;
const uploadTravelReceipt = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const travel = yield TravelRequest_js_1.default.findById(req.params.id);
        if (!travel) {
            return res.status(404).json({ message: "Travel request not found" });
        }
        if (((_a = travel.status) === null || _a === void 0 ? void 0 : _a.toUpperCase()) !== "APPROVED") {
            return res
                .status(400)
                .json({ message: "Receipt allowed only for approved travel" });
        }
        if (!req.file) {
            return res.status(400).json({ message: "Receipt file required" });
        }
        travel.receiptUrl = `/uploads/travel/${req.file.filename}`;
        yield travel.save();
        res.json(travel);
    }
    catch (error) {
        res.status(500).json({
            message: error.message || "Failed to upload receipt",
        });
    }
});
exports.uploadTravelReceipt = uploadTravelReceipt;
