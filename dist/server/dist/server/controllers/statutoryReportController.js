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
exports.generateStatutoryReports = exports.getStatutoryReports = void 0;
const Payslips_js_1 = __importDefault(require("../models/Payslips.js"));
const getStatutoryReports = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { month } = req.query;
        if (!month) {
            return res.status(400).json({ message: "Month is required" });
        }
        const payslips = yield Payslips_js_1.default.find({ month })
            .populate("user", "fullName username email")
            .lean();
        const reports = payslips.map((p) => {
            let employeeName = "Unknown";
            let employeeEmail = "";
            if (p.user) {
                employeeName = p.user.fullName || p.user.username || "Unknown";
                employeeEmail = p.user.email || "";
            }
            return {
                _id: p._id,
                employee: {
                    name: employeeName,
                    email: employeeEmail,
                },
                grossSalary: (p.basic || 0) + (p.hra || 0) + (p.otherAllowance || 0),
                pf: p.pf || 0,
                esi: 0, // ESI not explicitly stored, could be part of others
                pt: p.professionalTax || 0,
                tds: p.tds || 0,
                totalDeduction: p.deduction || 0,
                netSalary: p.netSalary || 0,
            };
        });
        res.json(reports);
    }
    catch (error) {
        console.error("Fetch Statutory Reports Error:", error);
        res.status(500).json({ message: "Failed to load statutory reports." });
    }
});
exports.getStatutoryReports = getStatutoryReports;
const generateStatutoryReports = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { month } = req.body;
        // Statutory reports are derived from Payslips.
        // Ensure payslips exist for the month.
        const count = yield Payslips_js_1.default.countDocuments({ month });
        if (count === 0) {
            return res.status(400).json({
                message: "No payslips found for this month. Please generate payslips first."
            });
        }
        res.json({ message: "Statutory Reports generated successfully." });
    }
    catch (error) {
        console.error("Generate Statutory Reports Error:", error);
        res.status(500).json({ message: "Failed to generate reports." });
    }
});
exports.generateStatutoryReports = generateStatutoryReports;
