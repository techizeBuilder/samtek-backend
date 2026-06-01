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
/** @format */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * 📄 Mock Payslip PDF Generator
 */
const generatePayslipPDF = (payslip) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    // Use process.cwd() to avoid __dirname issues in ESM/CJS mixed environments
    const dir = path_1.default.join(process.cwd(), "uploads", "payslips");
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
    const filename = `payslip_${payslip._id}.pdf`;
    const filePath = path_1.default.join(dir, filename);
    fs_1.default.writeFileSync(filePath, `PAYSLIP FOR ${(_a = payslip.user) === null || _a === void 0 ? void 0 : _a.name}\nMonth: ${payslip.month}\nNet Salary: ${payslip.netSalary}`);
    return filePath;
});
exports.default = generatePayslipPDF;
