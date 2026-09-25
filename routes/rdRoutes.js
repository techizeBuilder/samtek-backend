import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission, checkAnyPermission } from '../middleware/permissions.js';
import { rdDocumentUpload } from '../middleware/rdDocumentUpload.js';
import {
  getMachines, createMachine, updateMachine,
  updateDesignStatus, updateReleaseStatus, discontinueMachine, reactivateMachine,
  getBOMCostByMachineCode,
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
  getRDExpenseCategories,
  createRDExpense,
  getRDExpenses,
  getRDExpenseSummary,
  updateRDExpense,
  deleteRDExpense,
} from '../controllers/rdExpenseController.js';
import {
  generateSubChildPartMasterCode,
  getSubChildParts,
  getSubChildPart,
  createSubChildPart,
  updateSubChildPart as updateSubChildPartMaster,
} from '../controllers/subChildPartMasterController.js';
import {
  getSubChildPartSheetPlan,
  saveSubChildPartSheetPlan,
} from '../controllers/subChildPartSheetPlanController.js';
import {
  generateChildPartMasterCode,
  getChildPartMasters,
  getChildPartMaster,
  createChildPartMaster,
  updateChildPartMaster,
  addChildPartMasterSubChildPart,
  updateChildPartMasterSubChildPart,
  deleteChildPartMasterSubChildPart,
  discontinueChildPartMasterSubChildPart,
  reactivateChildPartMasterSubChildPart,
  addChildPartMasterMaterial,
  updateChildPartMasterMaterial,
  deleteChildPartMasterMaterial,
  discontinueChildPartMasterMaterial,
  reactivateChildPartMasterMaterial,
  updateChildPartMasterProductionCost,
  updateChildPartMasterProcessDefinition,
  searchSubChildPartInventory,
  uploadChildPartFile,
} from '../controllers/childPartBOMController.js';
import {
  getMachineBOM,
  createMachineBOM,
  addMachineBOMChildPart,
  updateMachineBOMChildPart,
  deleteMachineBOMChildPart,
  discontinueMachineBOMChildPart,
  reactivateMachineBOMChildPart,
  addMachineBOMMaterial,
  updateMachineBOMMaterial,
  deleteMachineBOMMaterial,
  discontinueMachineBOMMaterial,
  reactivateMachineBOMMaterial,
  updateMachineBOMProductionCost,
  updateMachineBOMProcessDefinition,
  downloadMachineBOMPdf,
  lockMachineBOM,
} from '../controllers/machineBOMController.js';
import {
  getProcessCategoryOptions,
  addProcessCategoryOption,
  updateProcessCategoryOption,
  deleteProcessCategoryOption,
  addInternalProcessOption,
  renameInternalProcessOption,
  deleteInternalProcessOption,
} from '../controllers/processCategoryOptionController.js';
import {
  getBOMFieldConfig,
  saveBOMFieldConfig,
} from '../controllers/rdBOMFieldConfigController.js';
import {
  getMasterChecklist,
  addMasterChecklistItem,
  updateMasterChecklistItem,
  deleteMasterChecklistItem,
  reorderMasterChecklist,
  getItemChecklist,
  saveItemChecklist,
  getProductQCParts,
  getChildPartQCList,
  getChildPartQCReference,
  getSubChildPartQCReference,
} from '../controllers/qcChecklistController.js';

const router = express.Router();
router.use(authenticateToken);

// ── Permission gates (module: 'rnd') ────────────────────────────────────────
// Feature keys verified against MODULES['rnd'].features in
// Samtek-Frontend/client/src/lib/roleModulesConfig.js: dashboard, inventory,
// approveRequests, productMaster, motorMaster, plantMaster, designApproval,
// bomManagement, toolProcess, prototype, changeManagement, qcInventory,
// qcProductMaster, qcMotorMaster, documentation, expenses, lms.
//
// 'qualityParameters' (below) was the old single Quality Parameters page's
// feature key — removed from MODULES/the sidebar (2026-08-31, see
// server/docs/qc-module-restructure-client-request.md: replaced with
// InventoryQC / ProductMasterQC / MotorMasterQC placeholder pages, built out
// one at a time). Left wired up here deliberately: the /quality-params
// routes/data are untouched and still live, just unreached by any current
// UI page — no new role gets this key granted by default anymore, but any
// existing permission doc that already has it keeps working.
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
// Cross-department read-only lookup — used by Machine BOM's own PDF download
// route below, which Production's Process Execution page calls directly with
// no R&D bomManagement grant of its own. Production only ever needs read
// access, so production.orders.view is accepted too.
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
// Cross-department read-only lookup only — Sales Order Form's minimum-billing
// check. The old per-machine BOM CRUD (create/lock/materials/PDF/sheet-metal
// plans) was removed along with the Legacy BOM Management tab; this one
// survives because it reads Item.stdCost, not an RDBOM document directly.
router.get('/boms/by-code/:code/cost', bomManagementView, getBOMCostByMachineCode);

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

// ── QC Checklist (Inventory QC / Product Master QC / Motor Master QC /
// Child Part QC / Sub Child Part QC) ────────────────────────────────────────
// Replaces the old Quality Params page for these sidebar entries (see
// server/docs/qc-module-restructure-client-request.md's 2026-08-31 and
// 2026-09-14 follow-ons). One controller/route set shared by every module —
// the URL's :module segment picks both which QCMasterChecklist document is
// read/written and, via this map, which feature key gates it. childPart/
// subChildPart (2026-09-14) are genuinely independent from productMaster —
// each configures its own checklist directly against its own Item, not
// shared/borrowed the way the old "Sub Child Part Inventory QC" tab used to.
const QC_MODULE_FEATURE = {
  inventory: 'qcInventory', productMaster: 'qcProductMaster', motorMaster: 'qcMotorMaster',
  childPart: 'qcChildPart', subChildPart: 'qcSubChildPart',
};
const checkQCModulePermission = (action) => (req, res, next) => {
  const feature = QC_MODULE_FEATURE[req.params.module];
  if (!feature) return res.status(400).json({ success: false, message: 'Invalid QC module' });
  return checkPermission('rnd', feature, action)(req, res, next);
};
// :stage is 'default' for the flat modules (Inventory QC / Motor Master QC)
// and 'initial'|'process'|'final' for Product Master QC (see
// QCMasterChecklist.js's QC_MODULE_STAGES — the controller itself validates
// the module+stage pair, this layer only resolves which feature key gates it).
router.get('/qc-checklist/:module/:stage/master', checkQCModulePermission('view'), getMasterChecklist);
router.post('/qc-checklist/:module/:stage/master', checkQCModulePermission('add'), addMasterChecklistItem);
router.put('/qc-checklist/:module/:stage/master/reorder', checkQCModulePermission('edit'), reorderMasterChecklist);
router.put('/qc-checklist/:module/:stage/master/:rowId', checkQCModulePermission('edit'), updateMasterChecklistItem);
router.delete('/qc-checklist/:module/:stage/master/:rowId', checkQCModulePermission('delete'), deleteMasterChecklistItem);
// Part-scoped route MUST be registered before the plain :itemId route so
// Express doesn't need any special ordering trick — both are distinct full
// paths (Express matches the longer, more specific one only when the URL
// actually has the extra /part/:childPartId/:subChildPartId segments).
router.get('/qc-checklist/:module/:stage/item/:itemId/part/:childPartId/:subChildPartId', checkQCModulePermission('view'), getItemChecklist);
router.post('/qc-checklist/:module/:stage/item/:itemId/part/:childPartId/:subChildPartId', checkQCModulePermission('edit'), saveItemChecklist);
router.get('/qc-checklist/:module/:stage/item/:itemId', checkQCModulePermission('view'), getItemChecklist);
router.post('/qc-checklist/:module/:stage/item/:itemId', checkQCModulePermission('edit'), saveItemChecklist);
// Product Master QC only — read-only Child Part/Sub Child Part + BOM tree
// (material/grade/brand/qty), always a live read off BOM Management's own
// data, never stored by this feature. Gated the same as every other
// Product Master QC route (qcProductMaster), not bomManagement, since this
// IS the QC page reading it, not BOM Management itself.
router.get('/qc-checklist/productMaster/parts/:productId', checkPermission('rnd', 'qcProductMaster', 'view'), getProductQCParts);

// Inventory QC page's "Child Part" tab — every Child Part Item with its own,
// independent module:'childPart' Initial/Process checklist counts (see
// getChildPartQCList's own comment for the 2026-09-14 rename/rescope).
router.get('/qc-checklist/child-part-list',
  checkPermission('rnd', 'qcChildPart', 'view'),
  getChildPartQCList);

// Read-only reference panels — "what is this part actually made of", a live
// read off the NEW hierarchy (ChildPartBOM / Item.subChildPartDetails), never
// stored by this QC feature. Same gating pattern as productMaster/parts above.
router.get('/qc-checklist/child-part/:itemId/reference',
  checkPermission('rnd', 'qcChildPart', 'view'),
  getChildPartQCReference);
router.get('/qc-checklist/sub-child-part/:itemId/reference',
  checkPermission('rnd', 'qcSubChildPart', 'view'),
  getSubChildPartQCReference);

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

// Backs ChildPartInventoryTab.jsx (R&D + Store Inventory) — a plain Item
// query, not tied to any BOM flow. Relocated into childPartBOMController.js
// when the old per-machine Child Part flow (rdChildPartController.js) was
// removed.
router.get('/sub-child-part-inventory', bomManagementView, searchSubChildPartInventory);
// Generic design-file upload, same relocation reason as above — still the
// live upload endpoint for Child Part Master / Sub Child Part Master / its
// Sheet Metal Plan's laser file.
router.post('/child-parts/upload-file', bomManagementAdd, rdDocumentUpload.single('file'), uploadChildPartFile);

// Process Definition master catalog (Category -> Internal Process) — shared
// picker source for all three BOM levels below (see
// server/docs/process-inhouse-outsource-redesign-discussion-2026-09.md).
// Registered before the level-specific blocks since it's a prerequisite for
// all three.
router.get('/process-category-options', bomManagementView, getProcessCategoryOptions);
router.post('/process-category-options', bomManagementAdd, addProcessCategoryOption);
router.put('/process-category-options/:id', bomManagementEdit, updateProcessCategoryOption);
router.delete('/process-category-options/:id', bomManagementDelete, deleteProcessCategoryOption);
router.post('/process-category-options/:id/internal-processes', bomManagementAdd, addInternalProcessOption);
router.put('/process-category-options/:id/internal-processes/rename', bomManagementEdit, renameInternalProcessOption);
router.delete('/process-category-options/:id/internal-processes/:name', bomManagementDelete, deleteInternalProcessOption);

// Sub Child Part Master — the new, standalone leaf node (see
// bom-hierarchy-redesign-2026-09.md). Not machine- or Child-Part-scoped;
// referencing one from a Child Part's own material list is the next build
// pass, not this one.
router.get('/sub-child-parts/generate-code', bomManagementView, generateSubChildPartMasterCode);
router.get('/sub-child-parts', bomManagementView, getSubChildParts);
router.get('/sub-child-parts/:id', bomManagementView, getSubChildPart);
router.post('/sub-child-parts', bomManagementAdd, createSubChildPart);
router.put('/sub-child-parts/:id', bomManagementEdit, updateSubChildPartMaster);
router.get('/sub-child-parts/:id/sheet-metal-plan', bomManagementView, getSubChildPartSheetPlan);
router.post('/sub-child-parts/:id/sheet-metal-plan', bomManagementAdd, saveSubChildPartSheetPlan);

// Child Part Master — the new, standalone Child Part catalog (see
// bom-hierarchy-redesign-2026-09.md §4, §9). See childPartBOMController.js
// for how a ChildPartBOM document's existence is what marks a record as
// belonging here. generate-code is registered before the plain :id route,
// same ordering reason as /sub-child-parts above.
router.get('/child-part-master/generate-code', bomManagementView, generateChildPartMasterCode);
router.get('/child-part-master', bomManagementView, getChildPartMasters);
router.get('/child-part-master/:id', bomManagementView, getChildPartMaster);
router.post('/child-part-master', bomManagementAdd, createChildPartMaster);
router.put('/child-part-master/:id', bomManagementEdit, updateChildPartMaster);
router.post('/child-part-master/:id/sub-child-parts', bomManagementAdd, addChildPartMasterSubChildPart);
router.put('/child-part-master/:id/sub-child-parts/:lineId', bomManagementEdit, updateChildPartMasterSubChildPart);
router.delete('/child-part-master/:id/sub-child-parts/:lineId', bomManagementDelete, deleteChildPartMasterSubChildPart);
router.put('/child-part-master/:id/sub-child-parts/:lineId/discontinue', bomManagementEdit, discontinueChildPartMasterSubChildPart);
router.put('/child-part-master/:id/sub-child-parts/:lineId/reactivate', bomManagementEdit, reactivateChildPartMasterSubChildPart);
router.post('/child-part-master/:id/materials', bomManagementAdd, addChildPartMasterMaterial);
router.put('/child-part-master/:id/materials/:lineId', bomManagementEdit, updateChildPartMasterMaterial);
router.delete('/child-part-master/:id/materials/:lineId', bomManagementDelete, deleteChildPartMasterMaterial);
router.put('/child-part-master/:id/materials/:lineId/discontinue', bomManagementEdit, discontinueChildPartMasterMaterial);
router.put('/child-part-master/:id/materials/:lineId/reactivate', bomManagementEdit, reactivateChildPartMasterMaterial);
router.put('/child-part-master/:id/production-cost', bomManagementEdit, updateChildPartMasterProductionCost);
router.put('/child-part-master/:id/process-definition', bomManagementEdit, updateChildPartMasterProcessDefinition);

// Machine BOM — the final node (see bom-hierarchy-redesign-2026-09.md §5,
// §9). See machineBOMController.js's own top comment for its shape.
router.get('/machine-bom/:machineId', bomManagementView, getMachineBOM);
router.post('/machine-bom', bomManagementAdd, createMachineBOM);
router.post('/machine-bom/:machineId/child-parts', bomManagementAdd, addMachineBOMChildPart);
router.put('/machine-bom/:machineId/child-parts/:lineId', bomManagementEdit, updateMachineBOMChildPart);
router.delete('/machine-bom/:machineId/child-parts/:lineId', bomManagementDelete, deleteMachineBOMChildPart);
router.put('/machine-bom/:machineId/child-parts/:lineId/discontinue', bomManagementEdit, discontinueMachineBOMChildPart);
router.put('/machine-bom/:machineId/child-parts/:lineId/reactivate', bomManagementEdit, reactivateMachineBOMChildPart);
router.post('/machine-bom/:machineId/materials', bomManagementAdd, addMachineBOMMaterial);
router.put('/machine-bom/:machineId/materials/:lineId', bomManagementEdit, updateMachineBOMMaterial);
router.delete('/machine-bom/:machineId/materials/:lineId', bomManagementDelete, deleteMachineBOMMaterial);
router.put('/machine-bom/:machineId/materials/:lineId/discontinue', bomManagementEdit, discontinueMachineBOMMaterial);
router.put('/machine-bom/:machineId/materials/:lineId/reactivate', bomManagementEdit, reactivateMachineBOMMaterial);
router.put('/machine-bom/:machineId/production-cost', bomManagementEdit, updateMachineBOMProductionCost);
router.put('/machine-bom/:machineId/process-definition', bomManagementEdit, updateMachineBOMProcessDefinition);
router.put('/machine-bom/:machineId/lock', bomManagementEdit, lockMachineBOM);
// Same dual-permission gate as the old RDBOM download route (bomByCodeView)
// — Production's own Process Execution page now calls this route directly
// (2026-09-16 cutover) to view/download a Machine's BOM, so a Production
// user with only 'production.orders.view' (no R&D BOM Management access)
// must still be able to reach it, same as before the cutover.
router.get('/machine-bom/:machineId/download', bomByCodeView, downloadMachineBOMPdf);

// ── BOM Format & Modification ────────────────────────────────────────────────
router.get('/bom-field-config', bomManagementView, getBOMFieldConfig);
router.put('/bom-field-config', bomManagementEdit, saveBOMFieldConfig);

export default router;
