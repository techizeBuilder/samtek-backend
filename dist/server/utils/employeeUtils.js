"use strict";
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
exports.generateEmployeeId = exports.getCompanyAbbr = void 0;
const User_js_1 = __importDefault(require("../models/User.js"));
const Company_js_1 = require("../models/Company.js");
const getCompanyAbbr = (companyName) => {
    if (!companyName)
        return "EMP";
    const letters = companyName.replace(/[^a-zA-Z]/g, "");
    return letters.substring(0, 3).toUpperCase();
};
exports.getCompanyAbbr = getCompanyAbbr;
const generateEmployeeId = (companyId) => __awaiter(void 0, void 0, void 0, function* () {
    let abbr = "EMP";
    if (companyId) {
        const company = yield Company_js_1.Company.findById(companyId).select("name");
        if (company === null || company === void 0 ? void 0 : company.name) {
            abbr = (0, exports.getCompanyAbbr)(company.name);
        }
    }
    const prefix = `EMP-${abbr}-`;
    const lastUser = yield User_js_1.default.findOne({
        employeeId: { $regex: `^${prefix}` },
    })
        .sort({ createdAt: -1 })
        .select("employeeId");
    let nextNumber = 1;
    if (lastUser === null || lastUser === void 0 ? void 0 : lastUser.employeeId) {
        const parts = lastUser.employeeId.split("-");
        const lastNumStr = parts[parts.length - 1];
        const lastNum = parseInt(lastNumStr, 10);
        if (!isNaN(lastNum))
            nextNumber = lastNum + 1;
    }
    return `${prefix}${String(nextNumber).padStart(4, "0")}`;
});
exports.generateEmployeeId = generateEmployeeId;
