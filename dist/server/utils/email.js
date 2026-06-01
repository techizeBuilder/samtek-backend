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
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendCommonEmail = exports.CommonEmailType = void 0;
exports.CommonEmailType = {
    PAYSLIP_GENERATED: "PAYSLIP_GENERATED",
    LEAVE_APPROVED: "LEAVE_APPROVED",
    LEAVE_REJECTED: "LEAVE_REJECTED",
    INTERVIEW_SCHEDULED: "INTERVIEW_SCHEDULED",
    LMS_CREDENTIALS: "LMS_CREDENTIALS",
};
/**
 * 📧 Mock Email Sender
 */
const sendCommonEmail = (_a) => __awaiter(void 0, [_a], void 0, function* ({ type, to, name, data }) {
    console.log(`[MOCK EMAIL] Sending ${type} to ${name} <${to}>`, data);
    return { success: true };
});
exports.sendCommonEmail = sendCommonEmail;
