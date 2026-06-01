"use strict";
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
exports.overrideBalance = exports.getHistory = exports.getCurrentBalance = exports.getMyBalances = void 0;
const LeaveBalanceAdjustment_js_1 = __importDefault(require("../models/LeaveBalanceAdjustment.js"));
const Leave_js_1 = __importDefault(require("../models/Leave.js"));
const LeaveType_js_1 = __importDefault(require("../models/LeaveType.js"));
const User_js_1 = __importDefault(require("../models/User.js"));
const mongoose_1 = __importDefault(require("mongoose"));
// GET /my-balances
const getMyBalances = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const empObjectId = new mongoose_1.default.Types.ObjectId(req.user._id);
        const leaveTypes = yield LeaveType_js_1.default.find({ isActive: true });
        const balances = yield Promise.all(leaveTypes.map((lt) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const usedAgg = yield Leave_js_1.default.aggregate([
                { $match: { employee: empObjectId, leaveType: lt.name, status: "APPROVED" } },
                { $group: { _id: null, total: { $sum: "$totalDays" } } }
            ]);
            const usedLeaves = ((_a = usedAgg[0]) === null || _a === void 0 ? void 0 : _a.total) || 0;
            const adjAgg = yield LeaveBalanceAdjustment_js_1.default.aggregate([
                { $match: { employee: empObjectId, leaveType: lt.name } },
                { $group: { _id: null, total: { $sum: "$adjustment" } } }
            ]);
            const totalAdjustments = ((_b = adjAgg[0]) === null || _b === void 0 ? void 0 : _b.total) || 0;
            return {
                leaveType: lt.name,
                balance: lt.maxDays + totalAdjustments - usedLeaves
            };
        })));
        res.json(balances);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch balances" });
    }
});
exports.getMyBalances = getMyBalances;
// GET /current?employeeId=...&leaveType=...
const getCurrentBalance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { employeeId, leaveType } = req.query;
        if (!employeeId || !leaveType)
            return res.status(400).json({ message: "Missing params" });
        const empObjectId = new mongoose_1.default.Types.ObjectId(employeeId);
        const ltDoc = yield LeaveType_js_1.default.findOne({ name: leaveType });
        if (!ltDoc)
            return res.status(404).json({ message: "Leave type not found" });
        const usedAgg = yield Leave_js_1.default.aggregate([
            { $match: { employee: empObjectId, leaveType: leaveType, status: "APPROVED" } },
            { $group: { _id: null, total: { $sum: "$totalDays" } } }
        ]);
        const usedLeaves = ((_a = usedAgg[0]) === null || _a === void 0 ? void 0 : _a.total) || 0;
        const adjAgg = yield LeaveBalanceAdjustment_js_1.default.aggregate([
            { $match: { employee: empObjectId, leaveType: leaveType } },
            { $group: { _id: null, total: { $sum: "$adjustment" } } }
        ]);
        const totalAdjustments = ((_b = adjAgg[0]) === null || _b === void 0 ? void 0 : _b.total) || 0;
        res.json({ balance: ltDoc.maxDays + totalAdjustments - usedLeaves });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch balance" });
    }
});
exports.getCurrentBalance = getCurrentBalance;
// GET /history
const getHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const history = yield LeaveBalanceAdjustment_js_1.default.find()
            .populate('employee', 'name fullName employeeId role')
            .populate('addedBy', 'name fullName role')
            .sort({ createdAt: -1 });
        res.json(history);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch history" });
    }
});
exports.getHistory = getHistory;
// POST /override
const overrideBalance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { employeeId, leaveType, newBalance, reason } = req.body;
        const empObjectId = new mongoose_1.default.Types.ObjectId(employeeId);
        const ltDoc = yield LeaveType_js_1.default.findOne({ name: leaveType });
        if (!ltDoc)
            return res.status(404).json({ message: "Leave type not found" });
        const usedAgg = yield Leave_js_1.default.aggregate([
            { $match: { employee: empObjectId, leaveType: leaveType, status: "APPROVED" } },
            { $group: { _id: null, total: { $sum: "$totalDays" } } }
        ]);
        const usedLeaves = ((_a = usedAgg[0]) === null || _a === void 0 ? void 0 : _a.total) || 0;
        const adjAgg = yield LeaveBalanceAdjustment_js_1.default.aggregate([
            { $match: { employee: empObjectId, leaveType: leaveType } },
            { $group: { _id: null, total: { $sum: "$adjustment" } } }
        ]);
        const totalAdjustments = ((_b = adjAgg[0]) === null || _b === void 0 ? void 0 : _b.total) || 0;
        const currentBalance = ltDoc.maxDays + totalAdjustments - usedLeaves;
        const adjustment = Number(newBalance) - currentBalance;
        const override = new LeaveBalanceAdjustment_js_1.default({
            employee: employeeId,
            leaveType,
            oldBalance: currentBalance,
            newBalance: Number(newBalance),
            adjustment,
            reason,
            addedBy: req.user._id
        });
        yield override.save();
        res.json({ message: "Balance overridden successfully", override });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to override balance" });
    }
});
exports.overrideBalance = overrideBalance;
