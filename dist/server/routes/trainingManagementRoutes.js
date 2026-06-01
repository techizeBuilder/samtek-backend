"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const lmsUpload_js_1 = require("../middleware/lmsUpload.js");
// Import all controllers
const TrainingManagementController_js_1 = require("../controllers/TrainingManagementController.js");
const TraineeLearningController_js_1 = require("../controllers/TraineeLearningController.js");
const router = express_1.default.Router();
// --- 1. Define Role Groups ---
const TOP_ADMINS = ['HR-Admin', 'MIS Admin', 'Company Admin', 'Super Admin', 'Admin'];
const DEPT_HEADS = [
    'Production Head', 'Packing Head', 'Dispatch Head',
    'Accounts Head', 'Sales Head', 'Manager', 'Finance Manager',
    'Unit Head', 'Unit Manager', 'Research & Development Head', 'Store Head', 'QC Head'
];
const ALL_MANAGEMENT = [...TOP_ADMINS, ...DEPT_HEADS];
// --- 2. Analytics Dashboard Route (Admin/Manager) ---
router.get('/admin/dashboard', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), TrainingManagementController_js_1.getDashboardAnalytics);
// ==========================================
// A. TRAINEE MANAGEMENT ROUTES (Admin/Manager)
// ==========================================
router.get('/certificate/download/:id', auth_js_1.authenticateToken, TrainingManagementController_js_1.downloadCertificate);
// Get fresh hires ready to be staged
router.get('/available-trainees', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), TrainingManagementController_js_1.getAvailableTrainees);
// Stage a candidate and assign modules
router.post('/stage-candidate', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), TrainingManagementController_js_1.stageCandidate);
// Get the active trainee list for the table
router.get('/trainees', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), TrainingManagementController_js_1.getActiveTrainees);
// Get full details for a specific trainee (Progress, Tests, Modules)
router.get('/trainees/:id', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), TrainingManagementController_js_1.getTraineeDetails);
// Update assigned courses for an already staged trainee
router.put('/trainees/:id/modules', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), TrainingManagementController_js_1.updateTraineeModules);
// Finalize trainee (Hire or Reject)
router.post('/trainees/:id/finalize', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), TrainingManagementController_js_1.finalizeTrainee);
// Hard delete a trainee and all associated LMS data
router.delete('/trainees/:id', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...TOP_ADMINS), TrainingManagementController_js_1.deleteTraineeRecord); // Usually restricted to Top Admins
// ==========================================
// B. MODULE MANAGEMENT ROUTES (Admin/Manager)
// ==========================================
// Create a new module (with file uploads)
router.post('/modules', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), lmsUpload_js_1.lmsUpload.array('files', 5), TrainingManagementController_js_1.createTrainingModule);
// Get all modules
router.get('/modules', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), TrainingManagementController_js_1.getModules);
// Update module details (Title, Category, etc.)
router.put('/modules/:id', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), TrainingManagementController_js_1.updateTrainingModule);
// Deactivate a module
router.delete('/modules/:id', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), TrainingManagementController_js_1.deactivateModule);
// Add new media to an existing module
router.post('/modules/:id/media', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), lmsUpload_js_1.lmsUpload.array('files', 5), TrainingManagementController_js_1.addMediaToModule);
// Remove specific media from a module
router.delete('/modules/:moduleId/media/:contentId', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), TrainingManagementController_js_1.removeMediaFromModule);
// ==========================================
// C. QUESTION BANK ROUTES (Admin/Manager)
// ==========================================
// Add a question to a specific module
router.post('/modules/:moduleId/questions', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), TrainingManagementController_js_1.addQuestionToModule);
// Get all questions for a module (Shows correct answers - MANAGERS ONLY)
router.get('/modules/:moduleId/questions', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), TrainingManagementController_js_1.getQuestions);
// Update a specific question
router.put('/questions/:questionId', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), TrainingManagementController_js_1.updateQuestion);
// Delete a question
router.delete('/questions/:questionId', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)(...ALL_MANAGEMENT), TrainingManagementController_js_1.deleteQuestion);
// ==========================================
// D. PHASE 2: TRAINEE / LEARNER ROUTES (Candidate View)
// Notice: No authorizeRoles. Any logged-in user can access their own training.
// ==========================================
// 1. Dashboard: Get assigned courses and overall progress
router.get('/my-learning/dashboard', auth_js_1.authenticateToken, TraineeLearningController_js_1.getMyDashboard);
// 2. Classroom: Get specific module details and initialize progress tracking
router.get('/my-learning/module/:moduleId', auth_js_1.authenticateToken, TraineeLearningController_js_1.getModuleLearningView);
// 3. Tracking: Mark a specific video or PDF as completed
router.post('/my-learning/module/mark-content-completed', auth_js_1.authenticateToken, TraineeLearningController_js_1.markContentCompleted);
// 4. Exam Room: Start the test (Starts server timer and shuffles questions)
router.post('/my-learning/module/:moduleId/start-test', auth_js_1.authenticateToken, TraineeLearningController_js_1.startTest);
// 5. Grading: Submit answers and grade the test (Enforces 2-Attempt Logic & Timer)
router.post('/my-learning/module/submit-test', auth_js_1.authenticateToken, TraineeLearningController_js_1.submitTest);
exports.default = router;
