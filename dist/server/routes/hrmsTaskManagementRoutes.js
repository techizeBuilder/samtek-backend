"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const taskUpload_js_1 = require("../middleware/taskUpload.js");
const auth_js_1 = require("../middleware/auth.js");
const hrmsTaskManagement_js_1 = require("../controllers/hrmsTaskManagement.js");
const router = express_1.default.Router();
// --- 1. Define Role Groups ---
const TOP_ADMINS = ['HR-Admin', 'MIS Admin', 'Company Admin', 'Super Admin', 'Admin'];
const DEPT_HEADS = [
    'Production Head', 'Packing Head', 'Dispatch Head',
    'Accounts Head', 'Sales Head', 'Manager', 'Finance Manager',
    'Unit Head', 'Unit Manager'
];
// --- 2. Base Authentication ---
// Ensures EVERY route below requires a valid login token
router.use(auth_js_1.authenticateToken);
// --- 3. STRICT ROUTES (Protected by authorizeRoles) ---
// Both Top Admins and Dept Heads need to be able to create tasks
router.post("/create", (0, auth_js_1.authorizeRoles)(...TOP_ADMINS, ...DEPT_HEADS), taskUpload_js_1.taskUpload.single("file"), hrmsTaskManagement_js_1.createTask);
// Only Top Admins should be allowed to completely delete a task
router.delete("/delete/:taskId", (0, auth_js_1.authorizeRoles)(...TOP_ADMINS, ...DEPT_HEADS), hrmsTaskManagement_js_1.deleteTask);
// --- 4. DYNAMIC ROUTES (Protected by the Controller) ---
// We DO NOT use authorizeRoles here because any logged-in user can hit these.
// Our controller's 3-Tier logic will automatically decide what data they are allowed to see/edit!
router.get("/all", hrmsTaskManagement_js_1.getAllTasks);
router.get("/dashboard", hrmsTaskManagement_js_1.getDashboardStats);
router.get("/task/:taskId", hrmsTaskManagement_js_1.getTaskById);
router.put("/update/:taskId", hrmsTaskManagement_js_1.updateTask);
router.post("/comment/:taskId", hrmsTaskManagement_js_1.addComment);
exports.default = router;
