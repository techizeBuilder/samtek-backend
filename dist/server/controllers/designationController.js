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
exports.deleteDesignation = exports.updateDesignation = exports.getDesignationById = exports.getDesignations = exports.createDesignation = void 0;
const Designation_1 = __importDefault(require("../models/Designation"));
const createDesignation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const data = Object.assign({}, req.body);
        if (data.departmentId === "") {
            data.departmentId = null;
        }
        const designation = yield Designation_1.default.create(data);
        res.status(201).json(designation);
    }
    catch (err) {
        res.status(400).json({ message: "Create failed", error: err.message });
    }
});
exports.createDesignation = createDesignation;
const getDesignations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { companyId, departmentId } = req.query;
    const filter = {};
    // Role-based filtering for Company Admin / Unit Head / etc.
    if (req.user && req.user.role !== 'Super Admin' && req.user.role !== 'HR-Admin') {
        if (req.user.companyId) {
            filter.companyId = req.user.companyId;
        }
    }
    if (companyId)
        filter.companyId = companyId;
    if (departmentId)
        filter.departmentId = departmentId;
    const data = yield Designation_1.default.find(filter)
        .populate("companyId", "name")
        .populate("departmentId", "name")
        .sort({ createdAt: -1 });
    res.json(data);
});
exports.getDesignations = getDesignations;
const getDesignationById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const data = yield Designation_1.default.findById(req.params.id)
        .populate("companyId", "name")
        .populate("departmentId", "name");
    res.json(data);
});
exports.getDesignationById = getDesignationById;
const updateDesignation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const data = Object.assign({}, req.body);
        if (data.departmentId === "") {
            data.departmentId = null;
        }
        const updated = yield Designation_1.default.findByIdAndUpdate(req.params.id, data, { new: true });
        res.json(updated);
    }
    catch (err) {
        res.status(400).json({ message: "Update failed", error: err.message });
    }
});
exports.updateDesignation = updateDesignation;
const deleteDesignation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    yield Designation_1.default.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted successfully" });
});
exports.deleteDesignation = deleteDesignation;
