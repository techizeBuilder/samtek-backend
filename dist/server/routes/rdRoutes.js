"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const rdDocumentUpload_js_1 = require("../middleware/rdDocumentUpload.js");
const rdController_js_1 = require("../controllers/rdController.js");
const router = express_1.default.Router();
router.use(auth_js_1.authenticateToken);
// ── Machines ─────────────────────────────────────────────────────────────────
router.get('/machines', rdController_js_1.getMachines);
router.post('/machines', rdController_js_1.createMachine);
router.put('/machines/:id', rdController_js_1.updateMachine);
router.put('/machines/:id/design-status', rdController_js_1.updateDesignStatus);
router.put('/machines/:id/release-status', rdController_js_1.updateReleaseStatus);
router.put('/machines/:id/discontinue', rdController_js_1.discontinueMachine);
router.put('/machines/:id/reactivate', rdController_js_1.reactivateMachine);
// ── BOMs ─────────────────────────────────────────────────────────────────────
router.get('/boms', rdController_js_1.getBOMs);
router.get('/boms/machine/:machineId', rdController_js_1.getBOMForMachine);
router.post('/boms', rdController_js_1.createBOM);
router.post('/boms/:id/materials', rdController_js_1.addMaterial);
router.put('/boms/:id/materials/:materialId', rdController_js_1.updateMaterial);
router.delete('/boms/:id/materials/:materialId', rdController_js_1.deleteMaterial);
router.put('/boms/:id/lock', rdController_js_1.lockBOM);
router.put('/boms/:id/materials/:materialId/discontinue', rdController_js_1.discontinueMaterial);
router.put('/boms/:id/materials/:materialId/reactivate', rdController_js_1.reactivateMaterial);
// ── Prototypes ────────────────────────────────────────────────────────────────
router.get('/prototypes', rdController_js_1.getPrototypes);
router.post('/prototypes', rdController_js_1.createPrototype);
router.put('/prototypes/:id', rdController_js_1.updatePrototype);
// ── Change Requests ───────────────────────────────────────────────────────────
router.get('/change-requests', rdController_js_1.getChangeRequests);
router.post('/change-requests', rdController_js_1.createChangeRequest);
router.put('/change-requests/:id/resolve', rdController_js_1.resolveChangeRequest);
// ── Tool Processes ────────────────────────────────────────────────────────────
router.get('/tool-processes', rdController_js_1.getToolProcesses);
router.post('/tool-processes/:machineId/tools', rdController_js_1.addTool);
router.delete('/tool-processes/:machineId/tools/:toolId', rdController_js_1.removeTool);
router.put('/tool-processes/:machineId/tools/:toolId/discontinue', rdController_js_1.discontinueTool);
router.put('/tool-processes/:machineId/tools/:toolId/reactivate', rdController_js_1.reactivateTool);
router.post('/tool-processes/:machineId/processes', rdController_js_1.addProcess);
router.delete('/tool-processes/:machineId/processes/:processId', rdController_js_1.removeProcess);
// ── Quality Params ────────────────────────────────────────────────────────────
router.get('/quality-params', rdController_js_1.getQualityParams);
router.post('/quality-params/parameters', rdController_js_1.addQualityParam);
router.delete('/quality-params/:machineId/parameters/:paramId', rdController_js_1.deleteQualityParam);
router.post('/quality-params/qc-items', rdController_js_1.addQCItem);
router.delete('/quality-params/:machineId/qc-items/:itemId', rdController_js_1.deleteQCItem);
// ── Documents ─────────────────────────────────────────────────────────────────
router.get('/documents', rdController_js_1.getDocuments);
router.post('/documents', rdDocumentUpload_js_1.rdDocumentUpload.single('file'), rdController_js_1.createDocument);
router.delete('/documents/:id', rdController_js_1.deleteDocument);
exports.default = router;
