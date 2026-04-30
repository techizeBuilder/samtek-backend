import express from "express";
import { taskUpload } from "../middleware/taskUpload.js";
import { authenticateToken, authorizeRoles } from "../middleware/auth.js";

import { 
    createTask, 
    getAllTasks, 
    deleteTask, 
    updateTask, 
    getDashboardStats, 
    addComment, 
    getTaskById 
} from "../controllers/hrmsTaskManagement.js";

const router = express.Router();

// --- 1. Define Role Groups ---
const TOP_ADMINS = ['HR-Admin', 'MIS Admin', 'Company Admin', 'Super Admin', 'Admin'];
const DEPT_HEADS = [
  'Production Head', 'Packing Head', 'Dispatch Head', 
  'Accounts Head', 'Sales Head', 'Manager', 'Finance Manager',
  'Unit Head', 'Unit Manager'
];

// --- 2. Base Authentication ---
// Ensures EVERY route below requires a valid login token
router.use(authenticateToken); 

// --- 3. STRICT ROUTES (Protected by authorizeRoles) ---
// Both Top Admins and Dept Heads need to be able to create tasks
router.post("/create", authorizeRoles(...TOP_ADMINS, ...DEPT_HEADS), taskUpload.single("file"), createTask);

// Only Top Admins should be allowed to completely delete a task
router.delete("/delete/:taskId", authorizeRoles(...TOP_ADMINS, ...DEPT_HEADS), deleteTask);


// --- 4. DYNAMIC ROUTES (Protected by the Controller) ---
// We DO NOT use authorizeRoles here because any logged-in user can hit these.
// Our controller's 3-Tier logic will automatically decide what data they are allowed to see/edit!
router.get("/all", getAllTasks);
router.get("/dashboard", getDashboardStats);
router.get("/task/:taskId", getTaskById);
router.put("/update/:taskId", updateTask);
router.post("/comment/:taskId", addComment);

export default router;