import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import {
  getAdminSettings,
  getGlobalSmtp, addGlobalSmtp, updateGlobalSmtp, deleteGlobalSmtp,
  leadStagesCrud,
  leadSourcesCrud,
  businessTypesCrud,
  documentTypesCrud,
  termsCrud,
  chargesCrud,
  notesCrud,
  dispatchChecklistCrud,
  leadRejectReasonsCrud,
  salesChecklistCrud,
  quotationNumberSettingsCrud,
  hrmsDocumentTypesCrud,
  rolesCrud,
} from '../controllers/adminSettingsController.js';

const router = express.Router();
router.use(authenticateToken);

// ─── Full settings (read all) ─────────────────────────────────────────────────
router.get('/', getAdminSettings);

// ─── SMTP (platform-wide, Super Admin only) ───────────────────────────────────
router.get('/global-smtp', authorizeRoles('Super Admin'), getGlobalSmtp);
router.post('/global-smtp', authorizeRoles('Super Admin'), addGlobalSmtp);
router.put('/global-smtp/:id', authorizeRoles('Super Admin'), updateGlobalSmtp);
router.delete('/global-smtp/:id', authorizeRoles('Super Admin'), deleteGlobalSmtp);

// ─── Lead Stages ──────────────────────────────────────────────────────────────
router.get('/lead-stages', leadStagesCrud.list);
router.post('/lead-stages', leadStagesCrud.add);
router.put('/lead-stages/:id', leadStagesCrud.update);
router.delete('/lead-stages/:id', leadStagesCrud.remove);
router.post('/lead-stages/reorder', leadStagesCrud.reorder);

// ─── Lead Sources ─────────────────────────────────────────────────────────────
router.get('/lead-sources', leadSourcesCrud.list);
router.post('/lead-sources', leadSourcesCrud.add);
router.put('/lead-sources/:id', leadSourcesCrud.update);
router.delete('/lead-sources/:id', leadSourcesCrud.remove);

// ─── Business Types ───────────────────────────────────────────────────────────
router.get('/business-types', businessTypesCrud.list);
router.post('/business-types', businessTypesCrud.add);
router.put('/business-types/:id', businessTypesCrud.update);
router.delete('/business-types/:id', businessTypesCrud.remove);

// ─── Document Types ───────────────────────────────────────────────────────────
router.get('/document-types', documentTypesCrud.list);
router.post('/document-types', documentTypesCrud.add);
router.put('/document-types/:id', documentTypesCrud.update);
router.delete('/document-types/:id', documentTypesCrud.remove);

// ─── Lead Reject Reasons ──────────────────────────────────────────────────────
router.get('/lead-reject-reasons', leadRejectReasonsCrud.list);
router.post('/lead-reject-reasons', leadRejectReasonsCrud.add);
router.put('/lead-reject-reasons/:id', leadRejectReasonsCrud.update);
router.delete('/lead-reject-reasons/:id', leadRejectReasonsCrud.remove);

// ─── Sales Checklist (Deal Won commitments, verified by Service team) ────────
// Platform-wide (Super Admin only edits it — shared by every company), so
// only the writes are role-gated; every role may still read it (Sales/Service).
router.get('/sales-checklist', salesChecklistCrud.list);
router.post('/sales-checklist', authorizeRoles('Super Admin'), salesChecklistCrud.add);
router.put('/sales-checklist/:id', authorizeRoles('Super Admin'), salesChecklistCrud.update);
router.delete('/sales-checklist/:id', authorizeRoles('Super Admin'), salesChecklistCrud.remove);

// ─── Terms & Conditions ───────────────────────────────────────────────────────
router.get('/terms', termsCrud.list);
router.post('/terms', termsCrud.add);
router.put('/terms/:id', termsCrud.update);
router.delete('/terms/:id', termsCrud.remove);

// ─── Additional Charges ───────────────────────────────────────────────────────
router.get('/charges', chargesCrud.list);
router.post('/charges', chargesCrud.add);
router.put('/charges/:id', chargesCrud.update);
router.delete('/charges/:id', chargesCrud.remove);

// ─── Quotation Notes ──────────────────────────────────────────────────────────
router.get('/notes', notesCrud.list);
router.post('/notes', notesCrud.add);
router.put('/notes/:id', notesCrud.update);
router.delete('/notes/:id', notesCrud.remove);

// ─── Dispatch Checklist ───────────────────────────────────────────────────────
router.get('/dispatch-checklist', dispatchChecklistCrud.list);
router.post('/dispatch-checklist', dispatchChecklistCrud.add);
router.put('/dispatch-checklist/:id', dispatchChecklistCrud.update);
router.delete('/dispatch-checklist/:id', dispatchChecklistCrud.remove);

// ─── Quotation Number Settings ────────────────────────────────────────────────
router.get('/quotation-number-settings', quotationNumberSettingsCrud.list);
router.post('/quotation-number-settings', quotationNumberSettingsCrud.add);
router.put('/quotation-number-settings/:id', quotationNumberSettingsCrud.update);
router.delete('/quotation-number-settings/:id', quotationNumberSettingsCrud.remove);

// ─── HRMS: Upload Document Settings ───────────────────────────────────────────
router.get('/hrms-document-types', hrmsDocumentTypesCrud.list);
router.post('/hrms-document-types', hrmsDocumentTypesCrud.add);
router.put('/hrms-document-types/:id', hrmsDocumentTypesCrud.update);
router.delete('/hrms-document-types/:id', hrmsDocumentTypesCrud.remove);

// ─── HRMS: Role Setting ────────────────────────────────────────────────────────
const canManageRoles = authorizeRoles('Super Admin', 'HR-Admin', 'Company Admin');
router.get('/roles', rolesCrud.list);
router.post('/roles', canManageRoles, rolesCrud.add);
router.put('/roles/:id', canManageRoles, rolesCrud.update);
router.delete('/roles/:id', canManageRoles, rolesCrud.remove);

export default router;
