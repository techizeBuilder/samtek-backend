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
exports.removeHrPolicyDocument = exports.uploadHrPolicyDocument = exports.getHrPolicies = exports.seedHrPolicies = void 0;
/** @format */
const HrPolicy_js_1 = require("../models/HrPolicy.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DEFAULT_POLICIES = [
    {
        no: 1,
        name: "Appointment & Employment Policy",
        requirements: [
            "Written appointment letter",
            "Job role & wage disclosure",
            "Probation terms",
            "Working hours",
            "Termination conditions",
        ],
        legalReference: "Shops & Establishment Acts / Code on Wages",
    },
    {
        no: 2,
        name: "Wage & Payroll Policy",
        requirements: [
            "Minimum wage compliance",
            "Timely salary payment",
            "Payslip issuance",
            "Overtime pay compliance",
            "Equal pay compliance",
        ],
        legalReference: "Code on Wages, 2019",
    },
    {
        no: 3,
        name: "Working Hours & Leave Policy",
        requirements: [
            "48 hrs/week limit",
            "Weekly holiday",
            "Overtime rules",
            "Earned leave",
            "State leave compliance",
        ],
        legalReference: "Shops & Establishment Act (State-wise)",
    },
    {
        no: 4,
        name: "POSH Policy",
        requirements: [
            "Internal Committee formation",
            "Woman Presiding Officer",
            "External member",
            "Complaint timelines",
            "Annual reporting",
        ],
        legalReference: "POSH Act, 2013",
    },
    {
        no: 5,
        name: "Maternity & Parental Leave Policy",
        requirements: [
            "26 weeks maternity leave",
            "Nursing breaks",
            "No dismissal during maternity",
            "Creche (50+ employees)",
            "Medical bonus",
        ],
        legalReference: "Maternity Benefit Act",
    },
    {
        no: 6,
        name: "PF & ESI Policy",
        requirements: [
            "PF registration (20+)",
            "ESI registration (10+)",
            "Employer & employee contribution",
            "Monthly filings",
            "UAN compliance",
        ],
        legalReference: "EPF Act / ESI Act",
    },
    {
        no: 7,
        name: "Gratuity Policy",
        requirements: [
            "10+ employees coverage",
            "5 years continuous service",
            "Calculation formula compliance",
            "Nomination forms",
            "Timely payment",
        ],
        legalReference: "Payment of Gratuity Act",
    },
    {
        no: 8,
        name: "Code of Conduct & Disciplinary Policy",
        requirements: [
            "Misconduct definition",
            "Disciplinary procedure",
            "Domestic inquiry process",
            "Suspension rules",
            "Appeal mechanism",
        ],
        legalReference: "Standing Orders Act",
    },
    {
        no: 9,
        name: "Termination & Exit Policy",
        requirements: [
            "Notice period compliance",
            "Full & final settlement",
            "Retrenchment compensation",
            "Gratuity & PF closure",
            "Documentation",
        ],
        legalReference: "Industrial Disputes Act",
    },
    {
        no: 10,
        name: "Health, Safety & Workplace Policy",
        requirements: [
            "Safe workplace",
            "Emergency procedures",
            "Fire safety compliance",
            "First-aid facilities",
            "Accident reporting",
        ],
        legalReference: "OSH Code, 2020",
    },
    {
        no: 11,
        name: "Child Protection Policy (Schools/EduTech)",
        requirements: [
            "No child labour",
            "Background verification",
            "Safeguarding protocol",
            "Reporting mechanism",
            "Student safety guidelines",
        ],
        legalReference: "POCSO Act / RTE Act",
    },
    {
        no: 12,
        name: "Data Protection & IT Usage Policy",
        requirements: [
            "Employee data handling",
            "Confidentiality clause",
            "IT usage guidelines",
            "Cybersecurity standards",
            "Data breach reporting",
        ],
        legalReference: "IT Act / DPDP Act, 2023",
    },
    {
        no: 13,
        name: "Anti-Discrimination & Equal Opportunity Policy",
        requirements: [
            "Equal pay compliance",
            "Non-discrimination",
            "Accessible workplace",
            "Complaint mechanism",
            "Inclusive hiring",
        ],
        legalReference: "Constitution of India / RPWD Act",
    },
    {
        no: 14,
        name: "Remote Work / WFH Policy",
        requirements: [
            "Working hours clarity",
            "Data security",
            "Expense reimbursement rules",
            "Monitoring guidelines",
            "Ergonomic advisory",
        ],
        legalReference: "Industry Practice",
    },
    {
        no: 15,
        name: "Training & Performance Management Policy",
        requirements: [
            "Appraisal structure",
            "KPI clarity",
            "Promotion criteria",
            "Documentation",
            "Feedback mechanism",
        ],
        legalReference: "Industry Practice",
    },
];
// Seed default policies if none exist
const seedHrPolicies = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const existing = yield HrPolicy_js_1.HrPolicy.countDocuments();
        if (existing === 0) {
            yield HrPolicy_js_1.HrPolicy.insertMany(DEFAULT_POLICIES);
        }
        const policies = yield HrPolicy_js_1.HrPolicy.find().sort({ no: 1 });
        res.json(policies);
    }
    catch (err) {
        res.status(500).json({ message: "Error seeding policies", error: err });
    }
});
exports.seedHrPolicies = seedHrPolicies;
// Get all HR Policies
const getHrPolicies = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let policies = yield HrPolicy_js_1.HrPolicy.find().sort({ no: 1 });
        if (policies.length === 0) {
            yield HrPolicy_js_1.HrPolicy.insertMany(DEFAULT_POLICIES);
            policies = yield HrPolicy_js_1.HrPolicy.find().sort({ no: 1 });
        }
        res.json(policies);
    }
    catch (err) {
        res.status(500).json({ message: "Error fetching policies", error: err });
    }
});
exports.getHrPolicies = getHrPolicies;
// Upload document for a specific policy
const uploadHrPolicyDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { policyId } = req.params;
        const file = req.file;
        if (!file)
            return res.status(400).json({ message: "No file uploaded" });
        const policy = yield HrPolicy_js_1.HrPolicy.findById(policyId);
        if (!policy)
            return res.status(404).json({ message: "Policy not found" });
        // Remove old file if exists
        if (policy.documentUrl) {
            const oldPath = path_1.default.join("uploads/hr-policies", path_1.default.basename(policy.documentUrl));
            if (fs_1.default.existsSync(oldPath)) {
                fs_1.default.unlinkSync(oldPath);
            }
        }
        policy.documentUrl = `uploads/hr-policies/${file.filename}`;
        policy.documentName = file.originalname;
        yield policy.save();
        res.json({
            message: "Document uploaded successfully",
            policy,
        });
    }
    catch (err) {
        res.status(500).json({ message: "Error uploading document", error: err });
    }
});
exports.uploadHrPolicyDocument = uploadHrPolicyDocument;
// Remove document from a policy
const removeHrPolicyDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { policyId } = req.params;
        const policy = yield HrPolicy_js_1.HrPolicy.findById(policyId);
        if (!policy)
            return res.status(404).json({ message: "Policy not found" });
        if (policy.documentUrl) {
            const filePath = policy.documentUrl;
            if (fs_1.default.existsSync(filePath))
                fs_1.default.unlinkSync(filePath);
        }
        policy.documentUrl = "";
        policy.documentName = "";
        yield policy.save();
        res.json({ message: "Document removed successfully", policy });
    }
    catch (err) {
        res.status(500).json({ message: "Error removing document", error: err });
    }
});
exports.removeHrPolicyDocument = removeHrPolicyDocument;
