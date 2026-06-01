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
exports.seedQCUser = void 0;
const User_js_1 = __importDefault(require("../models/User.js"));
const seedQCUser = () => __awaiter(void 0, void 0, void 0, function* () {
    const email = 'qchead@gmail.com';
    const password = '123456';
    // Find a user with companyId to copy the company assignment
    const refUser = yield User_js_1.default.findOne({ companyId: { $exists: true, $ne: null } }).lean();
    if (!refUser)
        return { success: false, message: 'No reference user with companyId found' };
    // Remove existing QC user if any
    yield User_js_1.default.deleteOne({ email });
    // Pass plain password — pre-save hook in User model handles hashing
    const user = yield User_js_1.default.create({
        username: 'qchead',
        email,
        password,
        fullName: 'QC Head',
        role: 'QC Head',
        isActive: true,
        companyId: refUser.companyId,
        permissions: {
            role: 'qc_head',
            canAccessAllUnits: false,
            modules: [
                {
                    name: 'quality-control',
                    dashboard: true,
                    features: [
                        { key: 'dashboard', view: true, add: false, edit: false, delete: false, alter: false },
                        { key: 'qcJobs', view: true, add: true, edit: true, delete: true, alter: true },
                        { key: 'inwardEntry', view: true, add: true, edit: true, delete: false, alter: false },
                        { key: 'inspection', view: true, add: true, edit: true, delete: false, alter: true },
                        { key: 'reports', view: true, add: false, edit: false, delete: false, alter: false },
                    ],
                },
            ],
        },
    });
    return {
        success: true,
        message: 'QC Head user created successfully',
        credentials: { email, password },
        companyId: refUser.companyId,
        userId: user._id,
    };
});
exports.seedQCUser = seedQCUser;
