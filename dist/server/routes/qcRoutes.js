"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const qcController_js_1 = require("../controllers/qcController.js");
const router = express_1.default.Router();
router.use(auth_js_1.authenticateToken);
// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', qcController_js_1.getDashboard);
// ── QC Jobs ───────────────────────────────────────────────────────────────────
router.get('/jobs', qcController_js_1.getQCJobs);
router.get('/jobs/:id', qcController_js_1.getQCJob);
router.post('/jobs', qcController_js_1.createQCJob);
router.put('/jobs/:id', qcController_js_1.updateQCJob);
// ── Inspection workflow ───────────────────────────────────────────────────────
router.put('/jobs/:id/start', qcController_js_1.startInspection);
router.put('/jobs/:id/checklist/:itemId', qcController_js_1.updateChecklistItem);
router.post('/jobs/:id/checklist', qcController_js_1.addChecklistItem);
router.delete('/jobs/:id/checklist/:itemId', qcController_js_1.removeChecklistItem);
router.put('/jobs/:id/decision', qcController_js_1.submitDecision);
exports.default = router;
