import express from "express";
import { taskUpload } from "../middleware/taskUpload.js";
import { authenticateToken, authorizeRoles } from "../middleware/auth.js";

// Import standard task controllers
import {
  createTask,
  getAllTasks,
  deleteTask,
  updateTask,
  getDashboardStats,
  addComment,
  getTaskById
} from "../controllers/hrmsTaskManagement.js";

// 🔥 Import report controllers
import {
  getEmployeePerformance,
  getOverdueTasks,
  getTaskTypeEfficiency,
  getProductivityTrends,
  exportEmployeeReportExcel,
  exportEmployeeReportPDF,
  exportOverdueReportExcel,
  exportOverdueReportPDF,
  exportTaskTypeEfficiencyExcel,
  exportTaskTypeEfficiencyPDF,
  exportProductivityExcel,
  exportProductivityPDF
} from "../controllers/TaskReportController.js";

const router = express.Router();

// --- 1. Define Role Groups ---
const TOP_ADMINS = ['HR-Admin', 'MIS Admin', 'Company Admin', 'Super Admin', 'Admin'];
const DEPT_HEADS = [
  'Production Head', 'Packing Head', 'Dispatch Head',
  'Accounts Head', 'Sales Head', 'Manager', 'Finance Manager',
  'Unit Head', 'Unit Manager', 'Research & Development Head', 'Store Head', 'QC Head'
];

// --- 2. Base Authentication ---
// Ensures EVERY route below requires a valid login token
router.use(authenticateToken);

// --- 3. STRICT ROUTES (Protected by authorizeRoles) ---
// Both Top Admins and Dept Heads need to be able to create tasks
router.post("/create", authorizeRoles(...TOP_ADMINS, ...DEPT_HEADS), taskUpload.single("file"), createTask);

// Only Top Admins and Dept Heads should be allowed to delete a task
router.delete("/delete/:taskId", authorizeRoles(...TOP_ADMINS, ...DEPT_HEADS), deleteTask);


// --- 4. DYNAMIC ROUTES (Protected by the Controller) ---
// We DO NOT use authorizeRoles here because any logged-in user can hit these.
// Our controller's 3-Tier logic will automatically decide what data they are allowed to see/edit!
router.get("/all", getAllTasks);
router.get("/dashboard", getDashboardStats);
router.get("/task/:taskId", getTaskById);
router.put("/update/:taskId", updateTask);
router.post("/comment/:taskId", addComment);


// --- 5. 📊 REPORT & EXPORT ROUTES (Protected by the Controller) ---
// These rely on the `buildReportQuery` gatekeeper inside `reportController.js` to block standard employees 
// and apply the correct Department locks for Dept Heads vs Top Admins.

// JSON Data Endpoints (For UI Dashboards/Charts)
router.get("/reports/employee-wise", getEmployeePerformance);
router.get("/reports/overdue", getOverdueTasks);
router.get("/reports/task-efficiency", getTaskTypeEfficiency);
router.get("/reports/productivity", getProductivityTrends);

// File Export Endpoints - Employee Performance
router.get("/reports/export/employee-wise/excel", exportEmployeeReportExcel);
router.get("/reports/export/employee-wise/pdf", exportEmployeeReportPDF);

// File Export Endpoints - Overdue Report
router.get("/reports/export/overdue/excel", exportOverdueReportExcel);
router.get("/reports/export/overdue/pdf", exportOverdueReportPDF);

// File Export Endpoints - Task Type Efficiency
router.get("/reports/export/task-efficiency/excel", exportTaskTypeEfficiencyExcel);
router.get("/reports/export/task-efficiency/pdf", exportTaskTypeEfficiencyPDF);

// File Export Endpoints - Productivity
router.get("/reports/export/productivity/excel", exportProductivityExcel);
router.get("/reports/export/productivity/pdf", exportProductivityPDF);

export default router;