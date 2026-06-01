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
exports.updateResignationStatus = exports.getTeamResignations = exports.getAllResignations = exports.deleteResignation = exports.updateResignation = exports.getMyResignations = exports.createResignation = void 0;
const Resignation_js_1 = __importDefault(require("../models/Resignation.js"));
const User_js_1 = __importDefault(require("../models/User.js"));
/* ================= EMPLOYEE: CREATE ================= */
const createResignation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { resignationType, reasonCategory, reasonText, expectedLastWorkingDay, documents } = req.body;
        const resignation = new Resignation_js_1.default({
            employee: req.user._id,
            resignationType,
            reasonCategory,
            reasonText,
            expectedLastWorkingDay,
            documents,
            status: "PENDING",
        });
        yield resignation.save();
        res.status(201).json({
            message: "Resignation request submitted successfully",
            resignation,
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to submit resignation" });
    }
});
exports.createResignation = createResignation;
/* ================= EMPLOYEE: GET MY ================= */
const getMyResignations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const data = yield Resignation_js_1.default.find({ employee: req.user._id }).sort({
            createdAt: -1,
        });
        res.json(data);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch resignations" });
    }
});
exports.getMyResignations = getMyResignations;
/* ================= EMPLOYEE: UPDATE ================= */
const updateResignation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { resignationType, reasonCategory, reasonText, expectedLastWorkingDay, documents } = req.body;
        const resignation = yield Resignation_js_1.default.findOne({
            _id: id,
            employee: req.user._id,
            status: "PENDING",
        });
        if (!resignation) {
            return res.status(404).json({ message: "Request not found or already processed" });
        }
        resignation.resignationType = resignationType || resignation.resignationType;
        resignation.reasonCategory = reasonCategory || resignation.reasonCategory;
        resignation.reasonText = reasonText || resignation.reasonText;
        resignation.expectedLastWorkingDay = expectedLastWorkingDay || resignation.expectedLastWorkingDay;
        resignation.documents = documents || resignation.documents;
        yield resignation.save();
        res.json({ message: "Resignation request updated successfully", resignation });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to update resignation" });
    }
});
exports.updateResignation = updateResignation;
/* ================= EMPLOYEE: DELETE ================= */
const deleteResignation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const resignation = yield Resignation_js_1.default.findOneAndDelete({
            _id: id,
            employee: req.user._id,
            status: "PENDING",
        });
        if (!resignation) {
            return res.status(404).json({ message: "Request not found or already processed" });
        }
        res.json({ message: "Resignation request deleted successfully" });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to delete resignation" });
    }
});
exports.deleteResignation = deleteResignation;
/* ================= MANAGER / ADMIN: GET ALL ================= */
const getAllResignations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const fetchedData = yield Resignation_js_1.default.find()
            .populate("employee", "fullName username email role")
            .sort({ createdAt: -1 })
            .lean();
        const data = fetchedData.map(r => {
            if (r.employee) {
                r.employee.name = r.employee.fullName || r.employee.username || 'Unknown';
            }
            return r;
        });
        res.json(data);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch all resignations" });
    }
});
exports.getAllResignations = getAllResignations;
/* ================= MANAGER: GET TEAM ================= */
const getTeamResignations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const managerId = req.user._id;
        const team = yield User_js_1.default.find({ reportingManager: managerId }, "_id");
        const teamIds = team.map((u) => u._id);
        const fetchedData = yield Resignation_js_1.default.find({ employee: { $in: teamIds } })
            .populate("employee", "fullName username email role")
            .sort({ createdAt: -1 })
            .lean();
        const data = fetchedData.map(r => {
            if (r.employee) {
                r.employee.name = r.employee.fullName || r.employee.username || 'Unknown';
            }
            return r;
        });
        res.json(data);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch team resignations" });
    }
});
exports.getTeamResignations = getTeamResignations;
/* ================= ADMIN / MANAGER: UPDATE STATUS ================= */
const updateResignationStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { status, adminRemark } = req.body;
        if (!["APPROVED", "REJECTED"].includes(status)) {
            return res.status(400).json({ message: "Invalid status" });
        }
        const resignation = yield Resignation_js_1.default.findById(id);
        if (!resignation) {
            return res.status(404).json({ message: "Resignation request not found" });
        }
        resignation.status = status;
        resignation.adminRemark = adminRemark;
        yield resignation.save();
        res.json({ message: `Resignation ${status.toLowerCase()} successfully`, resignation });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to update resignation status" });
    }
});
exports.updateResignationStatus = updateResignationStatus;
