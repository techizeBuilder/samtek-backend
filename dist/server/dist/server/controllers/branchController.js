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
exports.deleteBranch = exports.updateBranch = exports.getBranchById = exports.getAllBranches = exports.createBranch = void 0;
const Branch_1 = __importDefault(require("../models/Branch"));
/**
 * CREATE BRANCH
 */
const createBranch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const branch = yield Branch_1.default.create(Object.assign(Object.assign({}, req.body), { createdBy: (_a = req.user) === null || _a === void 0 ? void 0 : _a.id }));
        res.status(201).json(branch);
    }
    catch (error) {
        res.status(400).json({
            message: "Failed to create branch",
            error: error.message,
        });
    }
});
exports.createBranch = createBranch;
/**
 * GET ALL BRANCHES
 */
const getAllBranches = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { companyId } = req.query;
        const filter = {};
        if (companyId)
            filter.companyId = companyId;
        const branches = yield Branch_1.default.find(filter)
            .populate("companyId", "name")
            .sort({ createdAt: -1 });
        const formatted = branches.map((b) => {
            var _a;
            return (Object.assign(Object.assign({}, b.toObject()), { companyName: (_a = b.companyId) === null || _a === void 0 ? void 0 : _a.name }));
        });
        res.json(formatted);
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to fetch branches",
            error: error.message,
        });
    }
});
exports.getAllBranches = getAllBranches;
/**
 * GET BRANCH BY ID
 */
const getBranchById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const branch = yield Branch_1.default.findById(req.params.id).populate("companyId", "name");
        if (!branch) {
            return res.status(404).json({ message: "Branch not found" });
        }
        res.json(branch);
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to fetch branch",
            error: error.message,
        });
    }
});
exports.getBranchById = getBranchById;
/**
 * UPDATE BRANCH
 */
const updateBranch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const branch = yield Branch_1.default.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
        });
        if (!branch) {
            return res.status(404).json({ message: "Branch not found" });
        }
        res.json(branch);
    }
    catch (error) {
        res.status(400).json({
            message: "Failed to update branch",
            error: error.message,
        });
    }
});
exports.updateBranch = updateBranch;
/**
 * DELETE BRANCH
 */
const deleteBranch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const branch = yield Branch_1.default.findByIdAndDelete(req.params.id);
        if (!branch) {
            return res.status(404).json({ message: "Branch not found" });
        }
        res.json({ message: "Branch deleted successfully" });
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to delete branch",
            error: error.message,
        });
    }
});
exports.deleteBranch = deleteBranch;
