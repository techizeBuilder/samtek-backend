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
exports.deleteAllPayslips = exports.getMyPayslips = exports.sendPayslipToEmployee = exports.downloadPayslipPDF = exports.getAllPayslips = exports.generatePayslipsFromPayroll = void 0;
const Payslips_js_1 = __importDefault(require("../models/Payslips.js"));
const Payroll_js_1 = __importDefault(require("../models/Payroll.js"));
const generatePayslipPDF_js_1 = __importDefault(require("../utils/generatePayslipPDF.js"));
const SalaryStructure_js_1 = __importDefault(require("../models/SalaryStructure.js"));
const email_js_1 = require("../utils/email.js");
/* ================= GENERATE PAYSLIPS FROM PAYROLL ================= */
const generatePayslipsFromPayroll = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { month } = req.body;
        // 1️⃣ Sirf PAID payroll uthao
        const payrolls = yield Payroll_js_1.default.find({
            month,
            status: "Paid",
        }).populate("employee", "fullName username email");
        if (!payrolls.length) {
            return res.status(404).json({
                message: "No paid payroll found for this month",
            });
        }
        const createdPayslips = [];
        for (const payroll of payrolls) {
            const employee = payroll.employee;
            if (!employee)
                continue;
            // 2️⃣ Duplicate payslip check
            const exists = yield Payslips_js_1.default.findOne({
                user: employee._id,
                month,
            });
            if (exists)
                continue;
            // 3️⃣ Salary structure uthao
            const salary = yield SalaryStructure_js_1.default.findOne({
                employee: employee._id,
            });
            if (!salary)
                continue;
            // 🔍 YTD Calculations
            const [year, monthVal] = month.split("-").map(Number);
            // Financial Year start (April)
            const fiscalYearStartYear = monthVal < 4 ? year - 1 : year;
            const startMonth = `${fiscalYearStartYear}-04`;
            const previousPayslips = yield Payslips_js_1.default.find({
                user: employee._id,
                month: { $gte: startMonth, $lt: month }
            });
            const ytd = (field) => {
                const prevTotal = previousPayslips.reduce((acc, curr) => acc + (curr[field] || 0), 0);
                return prevTotal + (salary[field] || 0);
            };
            // 4️⃣ Payslip create
            const payslip = yield Payslips_js_1.default.create({
                user: employee._id,
                payroll: payroll._id,
                month,
                // 🔥 Salary breakdown (snaphost)
                basic: salary.basic,
                hra: salary.hra,
                otherAllowance: salary.otherAllowance,
                pf: salary.pf,
                professionalTax: salary.professionalTax,
                tds: salary.tds,
                advance: salary.advance,
                others: salary.others,
                // 📅 Days
                payDays: 30, // Default for now
                lopDays: 0,
                // 📈 YTD Snapshots
                ytdBasic: ytd("basic"),
                ytdHra: ytd("hra"),
                ytdOtherAllowance: ytd("otherAllowance"),
                ytdPf: ytd("pf"),
                ytdProfessionalTax: ytd("professionalTax"),
                ytdTds: ytd("tds"),
                ytdAdvance: ytd("advance"),
                ytdOthers: ytd("others"),
                // 🔥 Payroll calculation (actual paid)
                deduction: payroll.deduction,
                netSalary: payroll.net,
                status: "Generated",
            });
            createdPayslips.push(payslip);
            // 📧 EMAIL SEND (sirf jiski payslip bani)
            if (employee.email) {
                yield (0, email_js_1.sendCommonEmail)({
                    type: email_js_1.CommonEmailType.PAYSLIP_GENERATED,
                    to: employee.email,
                    name: employee.fullName || employee.username || 'Employee',
                    data: {
                        month,
                        downloadUrl: `${process.env.FRONTEND_URL}/payslip/${payslip._id}`,
                    },
                });
            }
        }
        res.status(201).json({
            message: "Payslips generated successfully",
            count: createdPayslips.length,
            payslips: createdPayslips, // 👈 direct return
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Payslip generation failed",
            error: error.message,
        });
    }
});
exports.generatePayslipsFromPayroll = generatePayslipsFromPayroll;
/* ================= HR: GET ALL PAYSLIPS ================= */
const getAllPayslips = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const payslips = yield Payslips_js_1.default.find()
            .populate("user", "fullName username email role")
            .populate("payroll") // ❌ koi match / filter nahi
            .sort({ createdAt: -1 });
        const formattedPayslips = payslips.map(p => {
            const pObj = p.toObject();
            if (pObj.user) {
                pObj.user.name = pObj.user.fullName || pObj.user.username || 'Unknown';
            }
            return pObj;
        });
        res.json(formattedPayslips);
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
});
exports.getAllPayslips = getAllPayslips;
/* ================= DOWNLOAD PAYSLIP PDF ================= */
const downloadPayslipPDF = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const payslip = yield Payslips_js_1.default.findById(req.params.id)
            .populate({
            path: "user",
            populate: [
                { path: "designationId", select: "name" },
                { path: "departmentId", select: "name" },
                { path: "branchId", select: "name" },
                { path: "companyId", select: "name address logo" }
            ],
            select: "fullName username email employeeId joiningDate pan pfNumber uan bankName bankAccountNumber ifscCode elBalance slBalance"
        })
            .populate("payroll");
        if (!payslip) {
            return res.status(404).json({ message: "Payslip not found" });
        }
        const pdfPath = yield (0, generatePayslipPDF_js_1.default)(payslip);
        res.download(pdfPath);
    }
    catch (error) {
        res.status(500).json({
            message: "PDF download failed",
            error: error.message,
        });
    }
});
exports.downloadPayslipPDF = downloadPayslipPDF;
/* ================= SEND PAYSLIP ================= */
const sendPayslipToEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const payslip = yield Payslips_js_1.default.findById(req.params.id).populate("user", "email fullName username");
        if (!payslip) {
            return res.status(404).json({ message: "Payslip not found" });
        }
        yield (0, generatePayslipPDF_js_1.default)(payslip);
        payslip.status = "Sent";
        payslip.sentAt = new Date();
        yield payslip.save();
        res.json({ message: "Payslip sent successfully" });
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to send payslip",
            error: error.message,
        });
    }
});
exports.sendPayslipToEmployee = sendPayslipToEmployee;
/* ================= EMPLOYEE: MY PAYSLIPS ================= */
const getMyPayslips = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user._id || req.user.userId || req.user.id;
        const payslips = yield Payslips_js_1.default.find({ user: userId })
            .populate("payroll")
            .sort({ month: -1 });
        res.json(payslips);
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
});
exports.getMyPayslips = getMyPayslips;
/* ================= DELETE ALL PAYSLIPS ================= */
const deleteAllPayslips = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield Payslips_js_1.default.deleteMany({});
        res.json({
            message: "All payslips deleted successfully",
            deletedCount: result.deletedCount,
        });
    }
    catch (error) {
        res.status(500).json({
            message: "Failed to delete payslips",
            error: error.message,
        });
    }
});
exports.deleteAllPayslips = deleteAllPayslips;
