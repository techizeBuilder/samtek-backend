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
exports.deleteDepartment = exports.updateDepartment = exports.getDepartmentById = exports.getDepartments = exports.createDepartment = void 0;
const Department_1 = __importDefault(require("../models/Department"));
/* CREATE */
const createDepartment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const department = yield Department_1.default.create(req.body);
        res.status(201).json(department);
    }
    catch (error) {
        res.status(400).json({
            message: "Failed to create department",
            error: error.message,
        });
    }
});
exports.createDepartment = createDepartment;
/* GET ALL */
const getDepartments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { branchId, companyId } = req.query;
    const filter = {};
    // Role-based filtering for Company Admin / Unit Head / etc.
    if (req.user && req.user.role !== 'Super Admin' && req.user.role !== 'HR-Admin') {
        if (req.user.companyId) {
            filter.companyId = req.user.companyId;
        }
    }
    if (branchId)
        filter.branchId = branchId;
    if (companyId)
        filter.companyId = companyId;
    const departments = yield Department_1.default.find(filter)
        .populate("companyId", "name")
        .populate("branchId", "name")
        .populate("headEmployeeId", "name email");
    res.json(departments);
});
exports.getDepartments = getDepartments;
/* GET BY ID */
const getDepartmentById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const department = yield Department_1.default.findById(req.params.id)
        .populate("companyId", "name")
        .populate("branchId", "name")
        .populate("headEmployeeId", "name email");
    if (!department) {
        return res.status(404).json({ message: "Department not found" });
    }
    res.json(department);
});
exports.getDepartmentById = getDepartmentById;
/* UPDATE */
const updateDepartment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const department = yield Department_1.default.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(department);
});
exports.updateDepartment = updateDepartment;
/* DELETE */
const deleteDepartment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    yield Department_1.default.findByIdAndDelete(req.params.id);
    res.json({ message: "Department deleted" });
});
exports.deleteDepartment = deleteDepartment;
