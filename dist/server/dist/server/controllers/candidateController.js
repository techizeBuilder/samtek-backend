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
exports.updateInterviewFeedback = exports.getCandidatesForManager = exports.deleteCandidate = exports.updateCandidateStatus = exports.updateCandidate = exports.getAllCandidates = exports.addCandidate = void 0;
const Candidate_js_1 = __importDefault(require("../models/Candidate.js"));
const JobOpenings_js_1 = __importDefault(require("../models/JobOpenings.js"));
/**
 * ➕ Add Candidate
 */
const addCandidate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, email, mobile, jobId, jobTitle, recruitingManager, hiringDate, joiningDate } = req.body;
        if (!name || !email || !jobId || !jobTitle || !mobile || !req.file) {
            return res.status(400).json({
                message: "Name, Email, Mobile, Job, Title and Resume are required",
            });
        }
        const resumeUrl = `/uploads/resumes/${req.file.filename}`;
        const candidate = yield Candidate_js_1.default.create({
            name,
            email,
            jobId,
            jobTitle,
            recruitingManager,
            mobile,
            resumeUrl,
            hiringDate,
            joiningDate,
        });
        res.status(201).json({
            message: "Candidate added successfully",
            candidate,
        });
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to add candidate",
            error: error.message,
        });
    }
});
exports.addCandidate = addCandidate;
/**
 * 📋 Get All Candidates
 */
const getAllCandidates = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const candidates = yield Candidate_js_1.default.find()
            .populate({
            path: "jobId",
            populate: {
                path: "recruitingManager",
                select: "name",
            },
        })
            .sort({ createdAt: -1 });
        res.json(candidates);
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to fetch candidates",
            error: error.message,
        });
    }
});
exports.getAllCandidates = getAllCandidates;
/**
 * 🔄 Update Candidate
 */
const updateCandidate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, email, mobile, jobId, jobTitle, recruitingManager, hiringDate, joiningDate } = req.body;
        const updateData = {
            name,
            email,
            jobId,
            jobTitle,
            recruitingManager,
            mobile,
            hiringDate,
            joiningDate,
        };
        if (req.file) {
            updateData.resumeUrl = `/uploads/resumes/${req.file.filename}`;
        }
        const candidate = yield Candidate_js_1.default.findByIdAndUpdate(req.params.id, updateData, {
            new: true,
        });
        if (!candidate) {
            return res.status(404).json({ message: "Candidate not found" });
        }
        res.json({ message: "Candidate updated successfully", candidate });
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to update candidate",
            error: error.message,
        });
    }
});
exports.updateCandidate = updateCandidate;
/**
 * 🔄 Update Status
 */
const updateCandidateStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status } = req.body;
        const candidate = yield Candidate_js_1.default.findByIdAndUpdate(req.params.id, { status }, { new: true });
        if (!candidate) {
            return res.status(404).json({ message: "Candidate not found" });
        }
        res.json({ message: "Status updated", candidate });
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to update status",
            error: error.message,
        });
    }
});
exports.updateCandidateStatus = updateCandidateStatus;
/**
 * 🗑️ Delete
 */
const deleteCandidate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const candidate = yield Candidate_js_1.default.findByIdAndDelete(req.params.id);
        if (!candidate) {
            return res.status(404).json({ message: "Candidate not found" });
        }
        res.json({ message: "Candidate deleted" });
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to delete candidate",
            error: error.message,
        });
    }
});
exports.deleteCandidate = deleteCandidate;
/**
 * 📋 Get Candidates for a specific Manager
 */
const getCandidatesForManager = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const managerId = req.user._id;
        // 1. Find jobs where this manager is the recruiting manager
        const jobs = yield JobOpenings_js_1.default.find({ recruitingManager: managerId }).select("_id");
        const jobIds = jobs.map((job) => job._id);
        // 2. Find candidates for these jobs OR directly assigned candidates
        const candidates = yield Candidate_js_1.default.find({
            $or: [
                { jobId: { $in: jobIds } },
                { recruitingManager: managerId },
            ],
        })
            .populate("jobId")
            .sort({ createdAt: -1 });
        res.json(candidates);
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to fetch candidates for manager",
            error: error.message,
        });
    }
});
exports.getCandidatesForManager = getCandidatesForManager;
/**
 * 🔄 Update Interview Rounds & Feedback
 */
const updateInterviewFeedback = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { applied, shortlisted, hrRound, techRound, offer, hired, feedback, status } = req.body;
        const candidate = yield Candidate_js_1.default.findByIdAndUpdate(req.params.id, {
            applied,
            shortlisted,
            hrRound,
            techRound,
            offer,
            hired,
            feedback,
            status
        }, { new: true });
        if (!candidate) {
            return res.status(404).json({ message: "Candidate not found" });
        }
        res.json({ message: "Interview feedback updated", candidate });
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to update interview feedback",
            error: error.message,
        });
    }
});
exports.updateInterviewFeedback = updateInterviewFeedback;
