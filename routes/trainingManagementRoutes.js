import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { checkAnyModuleFeature } from '../middleware/permissions.js';
import { lmsUpload } from '../middleware/lmsUpload.js';

// Import all controllers
import {
  getAvailableTrainees,
  stageCandidate,
  getActiveTrainees,
  getTraineeDetails,
  updateTraineeModules,
  finalizeTrainee,
  deleteTraineeRecord,
  createTrainingModule,
  getModules,
  updateTrainingModule,
  deactivateModule,
  addMediaToModule,
  updateMediaWatchTime,
  removeMediaFromModule,
  addQuestionToModule,
  getQuestions,
  updateQuestion,
  deleteQuestion,
  getDashboardAnalytics,
  downloadCertificate
} from '../controllers/TrainingManagementController.js';
import { getModuleLearningView, getMyDashboard, markContentCompleted, startTest, submitTest, getModuleTestInfo } from '../controllers/TraineeLearningController.js';

const router = express.Router();

// --- 1. Define Role Groups ---
// MIS Admin has no LMS entry in the sidebar at all (misAdminMenuItems has
// zero Training Management items) — excluded here so the backend doesn't
// grant an access level the frontend never offers.
const TOP_ADMINS = ['HR-Admin', 'Company Admin', 'Super Admin', 'Admin'];
const DEPT_HEADS = [
  'Production Head', 'Packing Head', 'Dispatch Head',
  'Accounts Head', 'Sales Head', 'Manager', 'Finance Manager',
  'Unit Head', 'Unit Manager', 'Research & Development Head', 'Store Head', 'QC Head'
];

const ALL_MANAGEMENT = [...TOP_ADMINS, ...DEPT_HEADS];

// LMS is duplicated as a feature in every module's roleModulesConfig.js
// catalog entry, so a management-tier user's real add/edit/delete/view
// access depends on whichever module they were actually assigned, not one
// fixed module name — checkAnyModuleFeature scans all of them. Roles with
// no catalog module at all (Manager, Finance Manager, Unit Head, Unit
// Manager) keep the authorizeRoles-only access they already had.
const lmsView = checkAnyModuleFeature('lms', 'view');
const lmsAdd = checkAnyModuleFeature('lms', 'add');
const lmsEdit = checkAnyModuleFeature('lms', 'edit');
const lmsDelete = checkAnyModuleFeature('lms', 'delete');

// --- 2. Analytics Dashboard Route (Admin/Manager) ---

router.get('/admin/dashboard', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsView, getDashboardAnalytics);


// ==========================================
// A. TRAINEE MANAGEMENT ROUTES (Admin/Manager)
// ==========================================

router.get('/certificate/download/:id', authenticateToken, downloadCertificate);

// Get fresh hires ready to be staged
router.get('/available-trainees', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsView, getAvailableTrainees);

// Stage a candidate and assign modules
router.post('/stage-candidate', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsAdd, stageCandidate);

// Get the active trainee list for the table
router.get('/trainees', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsView, getActiveTrainees);

// Get full details for a specific trainee (Progress, Tests, Modules)
router.get('/trainees/:id', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsView, getTraineeDetails);

// Update assigned courses for an already staged trainee
router.put('/trainees/:id/modules', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsEdit, updateTraineeModules);

// Finalize trainee (Hire or Reject) — restricted to Top Admins only; a
// candidate's onboarding decision shouldn't be a dept head/manager action,
// matching the frontend's own canFinalize gate.
router.post('/trainees/:id/finalize', authenticateToken, authorizeRoles(...TOP_ADMINS), lmsEdit, finalizeTrainee);

// Hard delete a trainee and all associated LMS data
router.delete('/trainees/:id', authenticateToken, authorizeRoles(...TOP_ADMINS), lmsDelete, deleteTraineeRecord); // Usually restricted to Top Admins


// ==========================================
// B. MODULE MANAGEMENT ROUTES (Admin/Manager)
// ==========================================

// Create a new module (with file uploads)
router.post('/modules', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsAdd, lmsUpload.array('files', 5), createTrainingModule);

// Get all modules
router.get('/modules', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsView, getModules);

// Update module details (Title, Category, etc.)
router.put('/modules/:id', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsEdit, updateTrainingModule);

// Deactivate a module
router.delete('/modules/:id', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsDelete, deactivateModule);

// Add new media to an existing module
router.post('/modules/:id/media', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsEdit, lmsUpload.array('files', 5), addMediaToModule);

// Remove specific media from a module
router.delete('/modules/:moduleId/media/:contentId', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsEdit, removeMediaFromModule);

// Update a content item's minimum watch time without re-uploading the file
router.put('/modules/:moduleId/media/:contentId', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsEdit, updateMediaWatchTime);


// ==========================================
// C. QUESTION BANK ROUTES (Admin/Manager)
// ==========================================

// Add a question to a specific module
router.post('/modules/:moduleId/questions', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsAdd, addQuestionToModule);

// Get all questions for a module (Shows correct answers - MANAGERS ONLY)
router.get('/modules/:moduleId/questions', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsView, getQuestions);

// Update a specific question
router.put('/questions/:questionId', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsEdit, updateQuestion);

// Delete a question
router.delete('/questions/:questionId', authenticateToken, authorizeRoles(...ALL_MANAGEMENT), lmsDelete, deleteQuestion);


// ==========================================
// D. PHASE 2: TRAINEE / LEARNER ROUTES (Candidate View)
// Notice: No authorizeRoles. Any logged-in user can access their own training.
// ==========================================

// 1. Dashboard: Get assigned courses and overall progress
router.get('/my-learning/dashboard', authenticateToken, getMyDashboard);

// 2. Classroom: Get specific module details and initialize progress tracking
router.get('/my-learning/module/:moduleId', authenticateToken, getModuleLearningView);

// 3. Tracking: Mark a specific video or PDF as completed
router.post('/my-learning/module/mark-content-completed', authenticateToken, markContentCompleted);

// 3b. Pre-Exam: Just the configured test duration, for the "Ready to begin?" screen
router.get('/my-learning/module/:moduleId/test-info', authenticateToken, getModuleTestInfo);

// 4. Exam Room: Start the test (Starts server timer and shuffles questions)
router.post('/my-learning/module/:moduleId/start-test', authenticateToken, startTest);

// 5. Grading: Submit answers and grade the test (Enforces 2-Attempt Logic & Timer)
router.post('/my-learning/module/submit-test', authenticateToken, submitTest);

export default router;