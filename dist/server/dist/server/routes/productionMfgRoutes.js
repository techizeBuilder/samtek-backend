"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const productionMfgController_js_1 = require("../controllers/productionMfgController.js");
const router = express_1.default.Router();
router.use(auth_js_1.authenticateToken);
// ── Orders ──────────────────────────────────────────────────────────────────
router.get('/orders', productionMfgController_js_1.getOrders);
router.post('/orders', productionMfgController_js_1.createOrder);
router.put('/orders/:id/verify-bom', productionMfgController_js_1.verifyBOM);
router.put('/orders/:id/verify-design', productionMfgController_js_1.verifyDesign);
router.put('/orders/:id/raise-rd-request', productionMfgController_js_1.raiseRDRequest);
router.put('/orders/:id/mark-material-issued', productionMfgController_js_1.markMaterialIssued);
// ── Material demands ────────────────────────────────────────────────────────
router.post('/orders/:id/materials', productionMfgController_js_1.addMaterialDemand);
router.put('/orders/:id/materials/:materialId/status', productionMfgController_js_1.updateMaterialStatus);
// ── Process steps  (stepIndex = 0–5) ───────────────────────────────────────
router.put('/orders/:id/processes/:stepIndex/assign-team', productionMfgController_js_1.assignTeam);
router.put('/orders/:id/processes/:stepIndex/start', productionMfgController_js_1.startProcess);
router.put('/orders/:id/processes/:stepIndex/complete', productionMfgController_js_1.markProcessComplete);
router.put('/orders/:id/processes/:stepIndex/approve-qc', productionMfgController_js_1.approveQC);
router.put('/orders/:id/processes/:stepIndex/reject-qc', productionMfgController_js_1.rejectQC);
router.put('/orders/:id/processes/:stepIndex/notes', productionMfgController_js_1.updateProcessNotes);
// ── Teams ───────────────────────────────────────────────────────────────────
router.get('/teams', productionMfgController_js_1.getTeams);
router.post('/teams', productionMfgController_js_1.createTeam);
exports.default = router;
