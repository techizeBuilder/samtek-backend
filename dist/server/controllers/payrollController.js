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
exports.recalculatePayroll = exports.rejectPayroll = exports.resetPayrollByMonth = exports.updatePayrollStatus = exports.savePayroll = exports.getPayrollByMonth = void 0;
const Payroll_js_1 = __importDefault(require("../models/Payroll.js"));
/* ================= GET PAYROLL BY MONTH ================= */
const getPayrollByMonth = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { month } = req.query;
        if (!month) {
            return res.status(400).json({ message: "Month required" });
        }
        const payroll = yield Payroll_js_1.default.find({ month })
            .populate("employee", "fullName username email role")
            .sort({ createdAt: -1 });
        const formattedPayroll = payroll.map(p => {
            const pObj = p.toObject();
            if (pObj.employee) {
                pObj.employee.name = pObj.employee.fullName || pObj.employee.username || 'Unknown';
            }
            return pObj;
        });
        res.json(formattedPayroll);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to fetch payroll" });
    }
});
exports.getPayrollByMonth = getPayrollByMonth;
/* ================= SAVE / UPDATE PAYROLL (RUN PAYROLL) ================= */
const savePayroll = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { month, payroll } = req.body;
        if (!month || !Array.isArray(payroll)) {
            return res.status(400).json({ message: "Invalid payload" });
        }
        const bulkOps = payroll.map((p) => ({
            updateOne: {
                filter: { employee: p.userId, month },
                update: {
                    $set: {
                        gross: p.gross,
                        deduction: p.deduction,
                        net: p.net,
                        payDays: p.payDays || 0,
                        lopDays: p.lopDays || 0,
                        status: "Paid",
                    },
                },
                upsert: true,
            },
        }));
        yield Payroll_js_1.default.bulkWrite(bulkOps);
        res.json({ message: "Payroll processed successfully" });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to save payroll" });
    }
});
exports.savePayroll = savePayroll;
/* ================= UPDATE STATUS (Paid) ================= */
const updatePayrollStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status } = req.body;
        const payrollDoc = yield Payroll_js_1.default.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate("employee", "fullName username email role");
        if (!payrollDoc) {
            return res.status(404).json({ message: "Payroll not found" });
        }
        const payroll = payrollDoc.toObject();
        if (payroll.employee) {
            payroll.employee.name = payroll.employee.fullName || payroll.employee.username || 'Unknown';
        }
        res.json(payroll);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to update payroll status" });
    }
});
exports.updatePayrollStatus = updatePayrollStatus;
/* ================= RESET PAYROLL BY MONTH (DEV / ADMIN) ================= */
const resetPayrollByMonth = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { month } = req.query;
        if (!month) {
            return res.status(400).json({ message: "Month required" });
        }
        // ❌ Paid payroll delete nahi hone chahiye
        const paidExists = yield Payroll_js_1.default.findOne({
            month,
            status: "Paid",
        });
        if (paidExists) {
            return res.status(400).json({
                message: "Cannot reset payroll. Some salaries are already paid.",
            });
        }
        yield Payroll_js_1.default.deleteMany({ month });
        res.json({
            message: `Payroll reset successfully for ${month}`,
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to reset payroll" });
    }
});
exports.resetPayrollByMonth = resetPayrollByMonth;
// PATCH /payroll/:id/reject
const rejectPayroll = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { reason } = req.body;
    if (!reason) {
        return res.status(400).json({ message: "Rejection reason required" });
    }
    const payroll = yield Payroll_js_1.default.findById(req.params.id);
    if (!payroll) {
        return res.status(404).json({ message: "Payroll not found" });
    }
    payroll.status = "Rejected";
    payroll.rejectReason = reason;
    payroll.rejectedAt = new Date();
    yield payroll.save();
    res.json(payroll);
});
exports.rejectPayroll = rejectPayroll;
/* ================= RECALCULATE REJECTED PAYROLL ================= */
const recalculatePayroll = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { payrollId, gross, deduction, net } = req.body;
        if (!payrollId) {
            return res.status(400).json({ message: "PayrollId required" });
        }
        const payroll = yield Payroll_js_1.default.findById(payrollId);
        if (!payroll) {
            return res.status(404).json({ message: "Payroll not found" });
        }
        // 🔒 SAFETY CHECKS
        if (payroll.status === "Paid") {
            return res
                .status(400)
                .json({ message: "Paid payroll cannot be recalculated" });
        }
        if (payroll.status !== "Rejected") {
            return res
                .status(400)
                .json({ message: "Only rejected payroll can be recalculated" });
        }
        // 👉 UPDATE WITH NEW CALCULATION
        payroll.gross = gross;
        payroll.deduction = deduction;
        payroll.net = net;
        payroll.payDays = req.body.payDays || 0;
        payroll.lopDays = req.body.lopDays || 0;
        payroll.status = "Paid"; // 🔥 reset status directly to paid
        payroll.rejectReason = undefined;
        payroll.rejectedAt = undefined;
        yield payroll.save();
        res.json({
            message: "Payroll recalculated successfully",
            payroll,
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to recalculate payroll" });
    }
});
exports.recalculatePayroll = recalculatePayroll;
