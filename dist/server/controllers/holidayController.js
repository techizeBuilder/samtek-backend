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
exports.deleteHolidayById = exports.updateHoliday = exports.getHolidayById = exports.getAllHolidays = exports.addHoliday = void 0;
const Holiday_js_1 = __importDefault(require("../models/Holiday.js"));
/**
 * ➕ Add Holiday
 */
/**
 * ➕ Add Holiday
 */
const addHoliday = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { title, date, companyId } = req.body;
        const currentUser = req.user;
        // Prevent Manager from adding holidays
        if (currentUser.role === 'Manager') {
            return res.status(403).json({ message: "Access denied. Managers cannot add holidays." });
        }
        if (!title || !date) {
            return res.status(400).json({
                message: "Holiday title and date are required",
            });
        }
        const holidayDate = new Date(date);
        const day = holidayDate.toLocaleDateString("en-US", {
            weekday: "long",
        });
        const holiday = yield Holiday_js_1.default.create({
            title,
            date: holidayDate,
            day,
            companyId: currentUser.role === 'Superadmin' ? companyId : currentUser.companyId,
        });
        res.status(201).json({
            message: "Holiday added successfully",
            holiday,
        });
    }
    catch (error) {
        console.error("Add holiday error:", error);
        res.status(500).json({
            message: "Failed to add holiday",
            error: error.message,
        });
    }
});
exports.addHoliday = addHoliday;
/**
 * 📋 Get All Holidays
 */
const getAllHolidays = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const currentUser = req.user;
        let filter = {};
        // Enforce Company Isolation
        if (currentUser.role !== 'Superadmin' && currentUser.role !== 'Super Admin') {
            if (currentUser.companyId) {
                filter.companyId = currentUser.companyId;
            }
        }
        else {
            // Superadmins can filter by companyId from query
            const { companyId } = req.query;
            if (companyId)
                filter.companyId = companyId;
        }
        const holidays = yield Holiday_js_1.default.find(filter).sort({ date: 1 });
        res.json(holidays);
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to fetch holidays",
            error: error.message,
        });
    }
});
exports.getAllHolidays = getAllHolidays;
/**
 * 🔍 Get Holiday By ID
 */
const getHolidayById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const holiday = yield Holiday_js_1.default.findById(req.params.id);
        if (!holiday) {
            return res.status(404).json({ message: "Holiday not found" });
        }
        res.json(holiday);
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to fetch holiday",
            error: error.message,
        });
    }
});
exports.getHolidayById = getHolidayById;
/**
 * ✏️ Update Holiday
 */
const updateHoliday = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { title, date } = req.body;
        const currentUser = req.user;
        // Prevent Manager from updating holidays
        if (currentUser.role === 'Manager') {
            return res.status(403).json({ message: "Access denied. Managers cannot edit holidays." });
        }
        const updateData = {};
        if (title)
            updateData.title = title;
        if (date) {
            updateData.date = date;
            updateData.day = new Date(date).toLocaleDateString("en-US", {
                weekday: "long",
            });
        }
        const holiday = yield Holiday_js_1.default.findByIdAndUpdate(req.params.id, updateData, {
            new: true,
        });
        if (!holiday) {
            return res.status(404).json({ message: "Holiday not found" });
        }
        res.json({
            message: "Holiday updated successfully",
            holiday,
        });
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to update holiday",
            error: error.message,
        });
    }
});
exports.updateHoliday = updateHoliday;
/**
 * 🗑️ Delete Holiday By ID
 */
const deleteHolidayById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const currentUser = req.user;
        // Prevent Manager from deleting holidays
        if (currentUser.role === 'Manager') {
            return res.status(403).json({ message: "Access denied. Managers cannot delete holidays." });
        }
        const holiday = yield Holiday_js_1.default.findByIdAndDelete(req.params.id);
        if (!holiday) {
            return res.status(404).json({ message: "Holiday not found" });
        }
        res.json({ message: "Holiday deleted successfully" });
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to delete holiday",
            error: error.message,
        });
    }
});
exports.deleteHolidayById = deleteHolidayById;
