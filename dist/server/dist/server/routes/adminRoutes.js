"use strict";
// Admin endpoint to check and fix user company assignments
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
const express_1 = __importDefault(require("express"));
const User_js_1 = __importDefault(require("../models/User.js"));
const Company_js_1 = require("../models/Company.js");
const router = express_1.default.Router();
// Check user company assignment
router.get('/check-user-company/:username', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { username } = req.params;
        console.log(`=== CHECKING COMPANY ASSIGNMENT FOR ${username} ===`);
        // Find user with populated company
        const user = yield User_js_1.default.findOne({ username }).populate('companyId');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
                username
            });
        }
        // Get all companies for reference
        const companies = yield Company_js_1.Company.find({}).select('name unitName city state');
        const response = {
            success: true,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                companyId: ((_a = user.companyId) === null || _a === void 0 ? void 0 : _a._id) || null,
                company: user.companyId ? {
                    id: user.companyId._id,
                    name: user.companyId.name,
                    unitName: user.companyId.unitName,
                    location: `${user.companyId.city}, ${user.companyId.state}`
                } : null
            },
            hasCompany: !!user.companyId,
            availableCompanies: companies.map(c => ({
                id: c._id,
                name: c.name,
                unitName: c.unitName,
                location: `${c.city}, ${c.state}`
            }))
        };
        console.log('User company status:', {
            username: user.username,
            hasCompany: !!user.companyId,
            companyName: ((_b = user.companyId) === null || _b === void 0 ? void 0 : _b.name) || 'None'
        });
        res.json(response);
    }
    catch (error) {
        console.error('Error checking user company:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
}));
// Assign company to user
router.post('/assign-company/:username', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { username } = req.params;
        const { companyId } = req.body;
        if (!companyId) {
            return res.status(400).json({
                success: false,
                message: 'companyId is required'
            });
        }
        console.log(`=== ASSIGNING COMPANY TO ${username} ===`);
        // Find user
        const user = yield User_js_1.default.findOne({ username });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        // Find company
        const company = yield Company_js_1.Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        // Assign company
        user.companyId = companyId;
        yield user.save();
        console.log('Company assigned successfully:', {
            username: user.username,
            companyName: company.name,
            location: `${company.city}, ${company.state}`
        });
        res.json({
            success: true,
            message: 'Company assigned successfully',
            user: {
                username: user.username,
                role: user.role,
                companyId: company._id,
                companyName: company.name,
                location: `${company.city}, ${company.state}`
            }
        });
    }
    catch (error) {
        console.error('Error assigning company:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
}));
exports.default = router;
