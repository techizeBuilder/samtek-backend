import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission, checkAnyPermission } from '../middleware/permissions.js';
import { rdDocumentUpload } from '../middleware/rdDocumentUpload.js';
import {
  getMachines, createMachine, updateMachine,
  updateDesignStatus, updateReleaseStatus, discontinueMachine, reactivateMachine,
  getBOMs, getBOMForMachine, getBOMByMachineCode, getBOMCostByMachineCode, createBOM, addMaterial, updateMaterial, deleteMaterial,
  lockBOM, downloadBOMPdf, discontinueMaterial, reactivateMaterial, updateBOMProductionCost,
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
  updateDropdownOption,
  deleteDropdownOption,
  getCustomFieldTemplates,
  saveCustomFieldTemplate,
  deleteCustomFieldTemplate,
  getPlants,
  createPlant,
  updatePlant,
  setPlantStatus,
} from '../controllers/rdController.js';
import {
  getSheetMetalGroups,
  getSheetMetalPlans,
  saveSheetMetalPlan,
  deleteSheetMetalPlan,
} from '../controllers/sheetMetalPlanController.js';
import {
  getRDExpenseCategories,
  createRDExpense,
  getRDExpenses,
  getRDExpenseSummary,
  updateRDExpense,
  deleteRDExpense,
} from '../controllers/rdExpenseController.js';
import {
  getChildParts,
  generateChildPartCode,
  createChildPart,
  updateChildPart,
  deleteChildPart,
  uploadChildPartFile,
  generateSubChildPartCode,
  addSubChildPart,
  updateSubChildPart,
  deleteSubChildPart,
} from '../controllers/rdChildPartController.js';
import {
  getBOMFieldConfig,
  saveBOMFieldConfig,
} from '../controllers/rdBOMFieldConfigController.js';

const router = express.Router();
router.use(authenticateToken);

// ── Permission gates (module: 'rnd') ────────────────────────────────────────
// Feature keys verified against MODULES['rnd'].features in
// Samtek-Frontend/client/src/lib/roleModulesConfig.js: dashboard, inventory,
// approveRequests, productMaster, motorMaster, plantMaster, designApproval,
// bomManagement, toolProcess, prototype, changeManagement, qualityParameters,
// documentation, expenses, lms.
const expensesView = checkPermission('rnd', 'expenses', 'view');
const expensesAdd = checkPermission('rnd', 'expenses', 'add');
const expensesEdit = checkPermission('rnd', 'expenses', 'edit');
const expensesDelete = checkPermission('rnd', 'expenses', 'delete');

const productMasterView = checkPermission('rnd', 'productMaster', 'view');
const productMasterAdd = checkPermission('rnd', 'productMaster', 'add');
const productMasterEdit = checkPermission('rnd', 'productMaster', 'edit');
const productMasterDelete = checkPermission('rnd', 'productMaster', 'delete');

// design-status / release-status are the machine's design/release governance
// workflow — design-status is confirmed (via DesignApproval.jsx / RDContext.jsx)
// to be used exclusively by the Design Approval page, so it's gated under
// designApproval rather than productMaster.
const designApprovalEdit = checkPermission('rnd', 'designApproval', 'edit');

const bomManagementView = checkPermission('rnd', 'bomManagement', 'view');
// getBOMByMachineCode is a cross-department read-only lookup — Production's
// Order Management ("Bill of Materials by Part", the View Material dialog)
// calls it directly by machine code, with no R&D bomManagement grant of its
// own. Gating it under bomManagementView alone silently 403'd every
// Production-only user; the request never surfaced as an error because the
// frontend's .catch() folds any failure into "No BOM found for this
// machine" — indistinguishable from a genuinely missing BOM. Production
// only ever needs read access, so production.orders.view is accepted too.
const bomByCodeView = checkAnyPermission([['rnd', 'bomManagement'], ['production', 'orders']], 'view');
const bomManagementAdd = checkPermission('rnd', 'bomManagement', 'add');
const bomManagementEdit = checkPermission('rnd', 'bomManagement', 'edit');
const bomManagementDelete = checkPermission('rnd', 'bomManagement', 'delete');

const prototypeView = checkPermission('rnd', 'prototype', 'view');
const prototypeAdd = checkPermission('rnd', 'prototype', 'add');
const prototypeEdit = checkPermission('rnd', 'prototype', 'edit');

const changeManagementView = checkPermission('rnd', 'changeManagement', 'view');
const changeManagementAdd = checkPermission('rnd', 'changeManagement', 'add');
const changeManagementEdit = checkPermission('rnd', 'changeManagement', 'edit');

const toolProcessView = checkPermission('rnd', 'toolProcess', 'view');
const toolProcessAdd = checkPermission('rnd', 'toolProcess', 'add');
const toolProcessEdit = checkPermission('rnd', 'toolProcess', 'edit');
const toolProcessDelete = checkPermission('rnd', 'toolProcess', 'delete');

const qualityParametersView = checkPermission('rnd', 'qualityParameters', 'view');
const qualityParametersAdd = checkPermission('rnd', 'qualityParameters', 'add');
const qualityParametersDelete = checkPermission('rnd', 'qualityParameters', 'delete');

const documentationView = checkPermission('rnd', 'documentation', 'view');
const documentationAdd = checkPermission('rnd', 'documentation', 'add');
const documentationDelete = checkPermission('rnd', 'documentation', 'delete');

const approveRequestsView = checkPermission('rnd', 'approveRequests', 'view');
const approveRequestsEdit = checkPermission('rnd', 'approveRequests', 'edit');

const plantMasterView = checkPermission('rnd', 'plantMaster', 'view');
const plantMasterAdd = checkPermission('rnd', 'plantMaster', 'add');
const plantMasterEdit = checkPermission('rnd', 'plantMaster', 'edit');

// ── R&D Expenses (raw material, designing, testing, labor) ─────────────────
router.get('/expenses/categories', expensesView, getRDExpenseCategories);
router.get('/expenses/summary', expensesView, getRDExpenseSummary);
router.get('/expenses', expensesView, getRDExpenses);
router.post('/expenses', expensesAdd, createRDExpense);
router.put('/expenses/:id', expensesEdit, updateRDExpense);
router.delete('/expenses/:id', expensesDelete, deleteRDExpense);

// ── Machines (Product Master) ────────────────────────────────────────────────
router.get('/machines', productMasterView, getMachines);
router.post('/machines', productMasterAdd, createMachine);
router.put('/machines/:id', productMasterEdit, updateMachine);
router.put('/machines/:id/design-status', designApprovalEdit, updateDesignStatus);
router.put('/machines/:id/release-status', designApprovalEdit, updateReleaseStatus);
router.put('/machines/:id/discontinue', productMasterEdit, discontinueMachine);
router.put('/machines/:id/reactivate', productMasterEdit, reactivateMachine);

// ── BOMs ─────────────────────────────────────────────────────────────────────
router.get('/boms', bomManagementView, getBOMs);
router.get('/boms/machine/:machineId', bomManagementView, getBOMForMachine);
router.get('/boms/by-code/:code', bomByCodeView, getBOMByMachineCode);
router.get('/boms/by-code/:code/cost', bomManagementView, getBOMCostByMachineCode);
router.post('/boms', bomManagementAdd, createBOM);
router.post('/boms/:id/materials', bomManagementAdd, addMaterial);
router.put('/boms/:id/materials/:materialId', bomManagementEdit, updateMaterial);
router.delete('/boms/:id/materials/:materialId', bomManagementDelete, deleteMaterial);
router.put('/boms/:id/lock', bomManagementEdit, lockBOM);
router.get('/boms/:id/download', bomManagementView, downloadBOMPdf);
router.put('/boms/:id/materials/:materialId/discontinue', bomManagementEdit, discontinueMaterial);
router.put('/boms/:id/materials/:materialId/reactivate', bomManagementEdit, reactivateMaterial);
router.put('/boms/:id/production-cost', bomManagementEdit, updateBOMProductionCost);
router.get('/boms/:bomId/sheet-metal-groups', bomManagementView, getSheetMetalGroups);
router.get('/boms/:bomId/sheet-metal-plans', bomManagementView, getSheetMetalPlans);
router.post('/boms/:bomId/sheet-metal-plans', bomManagementAdd, saveSheetMetalPlan);
router.delete('/boms/:bomId/sheet-metal-plans/:planId', bomManagementDelete, deleteSheetMetalPlan);

// ── Prototypes ────────────────────────────────────────────────────────────────
router.get('/prototypes', prototypeView, getPrototypes);
router.post('/prototypes', prototypeAdd, createPrototype);
router.put('/prototypes/:id', prototypeEdit, updatePrototype);

// ── Change Requests ───────────────────────────────────────────────────────────
router.get('/change-requests', changeManagementView, getChangeRequests);
router.post('/change-requests', changeManagementAdd, createChangeRequest);
router.put('/change-requests/:id/resolve', changeManagementEdit, resolveChangeRequest);

// ── Tool Processes ────────────────────────────────────────────────────────────
router.get('/tool-processes', toolProcessView, getToolProcesses);
router.post('/tool-processes/:machineId/tools', toolProcessAdd, addTool);
router.delete('/tool-processes/:machineId/tools/:toolId', toolProcessDelete, removeTool);
router.put('/tool-processes/:machineId/tools/:toolId/discontinue', toolProcessEdit, discontinueTool);
router.put('/tool-processes/:machineId/tools/:toolId/reactivate', toolProcessEdit, reactivateTool);
router.post('/tool-processes/:machineId/processes', toolProcessAdd, addProcess);
router.delete('/tool-processes/:machineId/processes/:processId', toolProcessDelete, removeProcess);

// ── Quality Params ────────────────────────────────────────────────────────────
router.get('/quality-params', qualityParametersView, getQualityParams);
router.post('/quality-params/parameters', qualityParametersAdd, addQualityParam);
router.delete('/quality-params/:machineId/parameters/:paramId', qualityParametersDelete, deleteQualityParam);
router.post('/quality-params/qc-items', qualityParametersAdd, addQCItem);
router.delete('/quality-params/:machineId/qc-items/:itemId', qualityParametersDelete, deleteQCItem);

// ── Documents ─────────────────────────────────────────────────────────────────
router.get('/documents', documentationView, getDocuments);
router.post('/documents', documentationAdd, rdDocumentUpload.single('file'), createDocument);
router.delete('/documents/:id', documentationDelete, deleteDocument);

//production rnd request
router.get('/production-rnd-requests', approveRequestsView, getRDRequests);
// PUT /api/rd-requests/:id/process
// Body: { "action": "Approve" } OR { "action": "Reject", "rejectReason": "Incomplete requirements" }
router.put('/:id/process', approveRequestsEdit, processRDRequest);
router.get('/production-rnd-requests/:id/review', approveRequestsView, getRDRequestReviewData);
// Master-options (RDMasterOption CRUD) is shared across three different
// features (productMaster, motorMaster, plantMaster — confirmed via frontend:
// ProductMaster.jsx, MotorMaster.jsx and PlantMaster.jsx all call this same
// endpoint for their own dropdown catalogues), with no per-caller distinction
// available server-side. Gated against ANY of the three (same pattern used
// for Store/R&D's shared inventory endpoints) so a legitimately-permissioned
// user of any of the three isn't 403'd, while someone with none of them
// still can't reach it.
const masterOptionsPairs = [['rnd', 'productMaster'], ['rnd', 'motorMaster'], ['rnd', 'plantMaster']];
const masterOptionsAdd = checkAnyPermission(masterOptionsPairs, 'add');
const masterOptionsEdit = checkAnyPermission(masterOptionsPairs, 'edit');
const masterOptionsDelete = checkAnyPermission(masterOptionsPairs, 'delete');
router.get('/master-options', getDropdownOptions);
router.post('/master-options', masterOptionsAdd, addDropdownOption);
router.put('/master-options/:id', masterOptionsEdit, updateDropdownOption);
router.delete('/master-options/:id', masterOptionsDelete, deleteDropdownOption);

// ── Custom Field Templates ───────────────────────────────────────────────────
// Confirmed Product-Master-only (docs/inventory-product-motor-plant-master.md:
// "ProductMaster.jsx | ... classification hierarchy manager, custom field
// template manager"; RDContext's getCustomFieldTemplate keys off
// pType/category/pSourceType, Product Master's own classification cascade).
router.get('/custom-field-templates', productMasterView, getCustomFieldTemplates);
router.post('/custom-field-templates', productMasterAdd, saveCustomFieldTemplate);
router.delete('/custom-field-templates/:id', productMasterDelete, deleteCustomFieldTemplate);

// ── Plant Master ──────────────────────────────────────────────────────────────
router.get('/plants', plantMasterView, getPlants);
router.post('/plants', plantMasterAdd, createPlant);
router.put('/plants/:id', plantMasterEdit, updatePlant);
router.put('/plants/:id/status', plantMasterEdit, setPlantStatus);

// ── Child Parts (BOM Management: Child Part Creation) ───────────────────────
router.get('/child-parts', bomManagementView, getChildParts);
router.get('/child-parts/generate-code', bomManagementView, generateChildPartCode);
router.post('/child-parts', bomManagementAdd, createChildPart);
router.put('/child-parts/:id', bomManagementEdit, updateChildPart);
router.delete('/child-parts/:id', bomManagementDelete, deleteChildPart);
router.post('/child-parts/upload-file', bomManagementAdd, rdDocumentUpload.single('file'), uploadChildPartFile);
router.get('/child-parts/:id/sub-parts/generate-code', bomManagementView, generateSubChildPartCode);
router.post('/child-parts/:id/sub-parts', bomManagementAdd, addSubChildPart);
router.put('/child-parts/:id/sub-parts/:subId', bomManagementEdit, updateSubChildPart);
router.delete('/child-parts/:id/sub-parts/:subId', bomManagementDelete, deleteSubChildPart);

// ── BOM Format & Modification ────────────────────────────────────────────────
router.get('/bom-field-config', bomManagementView, getBOMFieldConfig);
router.put('/bom-field-config', bomManagementEdit, saveBOMFieldConfig);

export default router;
