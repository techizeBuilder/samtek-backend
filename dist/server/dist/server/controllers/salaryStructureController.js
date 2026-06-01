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
exports.deleteSalaryStructureById = exports.updateSalaryStructure = exports.getSalaryStructureById = exports.getAllSalaryStructures = exports.addSalaryStructure = void 0;
const SalaryStructure_js_1 = __importDefault(require("../models/SalaryStructure.js"));
const User_js_1 = __importDefault(require("../models/User.js"));
/**
 * ➕ Add Salary Structure
 */
const addSalaryStructure = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employee, basic, hra, otherAllowance, pf, professionalTax, tds, advance, others } = req.body;
        if (!employee) {
            return res.status(400).json({ message: "Employee is required" });
        }
        // check duplicate
        const exists = yield SalaryStructure_js_1.default.findOne({ employee });
        if (exists) {
            return res.status(400).json({
                message: "Salary structure already exists for this employee",
            });
        }
        const salary = yield SalaryStructure_js_1.default.create({
            employee,
            basic,
            hra,
            otherAllowance,
            pf,
            professionalTax,
            tds,
            advance,
            others
        });
        res.status(201).json({
            message: "Salary structure added successfully",
            salary,
        });
    }
    catch (error) {
        console.error("Add salary error:", error);
        res.status(500).json({
            message: "Failed to add salary structure",
            error: error.message,
        });
    }
});
exports.addSalaryStructure = addSalaryStructure;
/**
 * 📋 Get All Salary Structures
 */
const getAllSalaryStructures = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { companyId } = req.query;
        let filter = {};
        if (companyId) {
            const users = yield User_js_1.default.find({ companyId }).select("_id");
            filter.employee = { $in: users.map(u => u._id) };
        }
        const salaryList = yield SalaryStructure_js_1.default.find(filter)
            .populate({
            path: "employee",
            select: "fullName email mobile role"
        })
            .sort({ createdAt: -1 });
        res.json(salaryList);
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to fetch salary structures",
            error: error.message,
        });
    }
});
exports.getAllSalaryStructures = getAllSalaryStructures;
/**
 * 🔍 Get Salary Structure By ID
 */
const getSalaryStructureById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const salary = yield SalaryStructure_js_1.default.find({ employee: req.params.id }).populate({
            path: "employee",
            select: "fullName email mobile role"
        });
        if (!salary) {
            return res.status(404).json({ message: "Salary structure not found" });
        }
        res.json(salary);
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to fetch salary structure",
            error: error.message,
        });
    }
});
exports.getSalaryStructureById = getSalaryStructureById;
/**
 * ✏️ Update Salary Structure
 */
const updateSalaryStructure = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { basic, hra, otherAllowance, pf, professionalTax, tds, advance, others } = req.body;
        const updateData = {};
        if (basic != null)
            updateData.basic = basic;
        if (hra != null)
            updateData.hra = hra;
        if (otherAllowance != null)
            updateData.otherAllowance = otherAllowance;
        if (pf != null)
            updateData.pf = pf;
        if (professionalTax != null)
            updateData.professionalTax = professionalTax;
        if (tds != null)
            updateData.tds = tds;
        if (advance != null)
            updateData.advance = advance;
        if (others != null)
            updateData.others = others;
        const salary = yield SalaryStructure_js_1.default.findByIdAndUpdate(req.params.id, updateData, { new: true }).populate({
            path: "employee",
            select: "fullName email mobile role"
        });
        if (!salary) {
            return res.status(404).json({ message: "Salary structure not found" });
        }
        res.json({
            message: "Salary structure updated successfully",
            salary,
        });
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to update salary structure",
            error: error.message,
        });
    }
});
exports.updateSalaryStructure = updateSalaryStructure;
/**
 * 🗑️ Delete Salary Structure
 */
const deleteSalaryStructureById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const salary = yield SalaryStructure_js_1.default.findByIdAndDelete(req.params.id);
        if (!salary) {
            return res.status(404).json({ message: "Salary structure not found" });
        }
        res.json({
            message: "Salary structure deleted successfully",
        });
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to delete salary structure",
            error: error.message,
        });
    }
});
exports.deleteSalaryStructureById = deleteSalaryStructureById;
