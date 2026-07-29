import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { rdDocumentUpload } from '../middleware/rdDocumentUpload.js';
import {
  getMachines, createMachine, updateMachine,
  updateDesignStatus, updateReleaseStatus, discontinueMachine, reactivateMachine,
  getBOMs, getBOMForMachine, getBOMByMachineCode, getBOMCostByMachineCode, createBOM, addMaterial, updateMaterial, deleteMaterial,
  lockBOM, discontinueMaterial, reactivateMaterial,
  getPrototypes, createPrototype, updatePrototype,
  getChangeRequests, createChangeRequest, resolveChangeRequest,
  getToolProcesses, addTool, removeTool, discontinueTool, reactivateTool, addProcess, removeProcess,
  getQualityParams, addQualityParam, deleteQualityParam, addQCItem, deleteQCItem,
  getDocuments, createDocument, deleteDocument,
  getRDRequests,
  processRDRequest,
  getRDRequestReviewData,
  getDropdownOptions,
  addDropdownOption,
  getCustomFieldTemplates,
  saveCustomFieldTemplate,
  deleteCustomFieldTemplate,
} from '../controllers/rdController.js';
import {
  getRDExpenseCategories,
  createRDExpense,
  getRDExpenses,
  getRDExpenseSummary,
  updateRDExpense,
  deleteRDExpense,
} from '../controllers/rdExpenseController.js';

const router = express.Router();
router.use(authenticateToken);

// ── R&D Expenses (raw material, designing, testing, labor) ─────────────────
router.get('/expenses/categories', getRDExpenseCategories);
router.get('/expenses/summary', getRDExpenseSummary);
router.get('/expenses', getRDExpenses);
router.post('/expenses', createRDExpense);
router.put('/expenses/:id', updateRDExpense);
router.delete('/expenses/:id', deleteRDExpense);

// ── Machines ─────────────────────────────────────────────────────────────────
router.get('/machines', getMachines);
router.post('/machines', createMachine);
router.put('/machines/:id', updateMachine);
router.put('/machines/:id/design-status', updateDesignStatus);
router.put('/machines/:id/release-status', updateReleaseStatus);
router.put('/machines/:id/discontinue', discontinueMachine);
router.put('/machines/:id/reactivate', reactivateMachine);

// ── BOMs ─────────────────────────────────────────────────────────────────────
router.get('/boms', getBOMs);
router.get('/boms/machine/:machineId', getBOMForMachine);
router.get('/boms/by-code/:code', getBOMByMachineCode);
router.get('/boms/by-code/:code/cost', getBOMCostByMachineCode);
router.post('/boms', createBOM);
router.post('/boms/:id/materials', addMaterial);
router.put('/boms/:id/materials/:materialId', updateMaterial);
router.delete('/boms/:id/materials/:materialId', deleteMaterial);
router.put('/boms/:id/lock', lockBOM);
router.put('/boms/:id/materials/:materialId/discontinue', discontinueMaterial);
router.put('/boms/:id/materials/:materialId/reactivate', reactivateMaterial);

// ── Prototypes ────────────────────────────────────────────────────────────────
router.get('/prototypes', getPrototypes);
router.post('/prototypes', createPrototype);
router.put('/prototypes/:id', updatePrototype);

// ── Change Requests ───────────────────────────────────────────────────────────
router.get('/change-requests', getChangeRequests);
router.post('/change-requests', createChangeRequest);
router.put('/change-requests/:id/resolve', resolveChangeRequest);

// ── Tool Processes ────────────────────────────────────────────────────────────
router.get('/tool-processes', getToolProcesses);
router.post('/tool-processes/:machineId/tools', addTool);
router.delete('/tool-processes/:machineId/tools/:toolId', removeTool);
router.put('/tool-processes/:machineId/tools/:toolId/discontinue', discontinueTool);
router.put('/tool-processes/:machineId/tools/:toolId/reactivate', reactivateTool);
router.post('/tool-processes/:machineId/processes', addProcess);
router.delete('/tool-processes/:machineId/processes/:processId', removeProcess);

// ── Quality Params ────────────────────────────────────────────────────────────
router.get('/quality-params', getQualityParams);
router.post('/quality-params/parameters', addQualityParam);
router.delete('/quality-params/:machineId/parameters/:paramId', deleteQualityParam);
router.post('/quality-params/qc-items', addQCItem);
router.delete('/quality-params/:machineId/qc-items/:itemId', deleteQCItem);

// ── Documents ─────────────────────────────────────────────────────────────────
router.get('/documents', getDocuments);
router.post('/documents', rdDocumentUpload.single('file'), createDocument);
router.delete('/documents/:id', deleteDocument);

//production rnd request
router.get('/production-rnd-requests', getRDRequests);
// PUT /api/rd-requests/:id/process
// Body: { "action": "Approve" } OR { "action": "Reject", "rejectReason": "Incomplete requirements" }
router.put('/:id/process', processRDRequest);
router.get('/production-rnd-requests/:id/review', getRDRequestReviewData);
// New Routes for Dynamic Dropdowns
router.get('/master-options', getDropdownOptions);
router.post('/master-options', addDropdownOption);

// ── Custom Field Templates ───────────────────────────────────────────────────
router.get('/custom-field-templates', getCustomFieldTemplates);
router.post('/custom-field-templates', saveCustomFieldTemplate);
router.delete('/custom-field-templates/:id', deleteCustomFieldTemplate);

export default router;
