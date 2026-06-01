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
exports.deleteLeaveTypeById = exports.updateLeaveType = exports.getLeaveTypeById = exports.getAllLeaveTypes = exports.addLeaveType = void 0;
const LeaveType_js_1 = __importDefault(require("../models/LeaveType.js"));
// @desc    Add new Leave Type
// @route   POST /api/leave-types
const addLeaveType = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, code, maxDays, paid, carryForward, isActive } = req.body;
        const existingLeaveType = yield LeaveType_js_1.default.findOne({ code });
        if (existingLeaveType) {
            return res.status(400).json({ message: "Leave type with this code already exists" });
        }
        const leaveType = yield LeaveType_js_1.default.create({
            name,
            code,
            maxDays,
            paid,
            carryForward,
            isActive,
        });
        res.status(201).json({ message: "Leave type created successfully", leaveType });
    }
    catch (error) {
        console.error("Error creating leave type:", error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});
exports.addLeaveType = addLeaveType;
// @desc    Get all Leave Types
// @route   GET /api/leave-types
const getAllLeaveTypes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leaveTypes = yield LeaveType_js_1.default.find().sort({ createdAt: -1 });
        res.status(200).json(leaveTypes);
    }
    catch (error) {
        console.error("Error fetching leave types:", error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});
exports.getAllLeaveTypes = getAllLeaveTypes;
// @desc    Get a single Leave Type by ID
// @route   GET /api/leave-types/:id
const getLeaveTypeById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leaveType = yield LeaveType_js_1.default.findById(req.params.id);
        if (!leaveType) {
            return res.status(404).json({ message: "Leave type not found" });
        }
        res.status(200).json(leaveType);
    }
    catch (error) {
        console.error("Error fetching leave type by ID:", error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});
exports.getLeaveTypeById = getLeaveTypeById;
// @desc    Update a Leave Type
// @route   PUT /api/leave-types/:id
const updateLeaveType = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, code, maxDays, paid, carryForward, isActive } = req.body;
        const leaveType = yield LeaveType_js_1.default.findById(req.params.id);
        if (!leaveType) {
            return res.status(404).json({ message: "Leave type not found" });
        }
        if (code && code !== leaveType.code) {
            const existingLeaveType = yield LeaveType_js_1.default.findOne({ code });
            if (existingLeaveType) {
                return res.status(400).json({ message: "Leave type with this code already exists" });
            }
        }
        leaveType.name = name !== undefined ? name : leaveType.name;
        leaveType.code = code !== undefined ? code : leaveType.code;
        leaveType.maxDays = maxDays !== undefined ? maxDays : leaveType.maxDays;
        leaveType.paid = paid !== undefined ? paid : leaveType.paid;
        leaveType.carryForward = carryForward !== undefined ? carryForward : leaveType.carryForward;
        leaveType.isActive = isActive !== undefined ? isActive : leaveType.isActive;
        const updatedLeaveType = yield leaveType.save();
        res.status(200).json({ message: "Leave type updated successfully", leaveType: updatedLeaveType });
    }
    catch (error) {
        console.error("Error updating leave type:", error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});
exports.updateLeaveType = updateLeaveType;
// @desc    Delete a Leave Type
// @route   DELETE /api/leave-types/:id
const deleteLeaveTypeById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leaveType = yield LeaveType_js_1.default.findByIdAndDelete(req.params.id);
        if (!leaveType) {
            return res.status(404).json({ message: "Leave type not found" });
        }
        res.status(200).json({ message: "Leave type deleted successfully" });
    }
    catch (error) {
        console.error("Error deleting leave type:", error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});
exports.deleteLeaveTypeById = deleteLeaveTypeById;
