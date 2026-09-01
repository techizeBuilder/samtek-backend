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

// Every "General" settings section below is platform-wide — one shared list
// configured by Super Admin, read by every company (see GlobalAdminSettings /
// GlobalSalesChecklist / GlobalSmtpSettings). Reads stay open to any
// authenticated role since Sales/Service/etc. all consume these lists; only
// the writes are Super-Admin-gated.
const superAdminOnly = authorizeRoles('Super Admin');

// ─── Full settings (read all) ─────────────────────────────────────────────────
router.get('/', getAdminSettings);

// ─── SMTP (platform-wide, Super Admin only) ───────────────────────────────────
router.get('/global-smtp', superAdminOnly, getGlobalSmtp);
router.post('/global-smtp', superAdminOnly, addGlobalSmtp);
router.put('/global-smtp/:id', superAdminOnly, updateGlobalSmtp);
router.delete('/global-smtp/:id', superAdminOnly, deleteGlobalSmtp);

// ─── Lead Stages ──────────────────────────────────────────────────────────────
router.get('/lead-stages', leadStagesCrud.list);
router.post('/lead-stages', superAdminOnly, leadStagesCrud.add);
router.put('/lead-stages/:id', superAdminOnly, leadStagesCrud.update);
router.delete('/lead-stages/:id', superAdminOnly, leadStagesCrud.remove);
router.post('/lead-stages/reorder', superAdminOnly, leadStagesCrud.reorder);

// ─── Lead Sources ─────────────────────────────────────────────────────────────
router.get('/lead-sources', leadSourcesCrud.list);
router.post('/lead-sources', superAdminOnly, leadSourcesCrud.add);
router.put('/lead-sources/:id', superAdminOnly, leadSourcesCrud.update);
router.delete('/lead-sources/:id', superAdminOnly, leadSourcesCrud.remove);

// ─── Business Types ───────────────────────────────────────────────────────────
router.get('/business-types', businessTypesCrud.list);
router.post('/business-types', superAdminOnly, businessTypesCrud.add);
router.put('/business-types/:id', superAdminOnly, businessTypesCrud.update);
router.delete('/business-types/:id', superAdminOnly, businessTypesCrud.remove);

// ─── Document Types ───────────────────────────────────────────────────────────
router.get('/document-types', documentTypesCrud.list);
router.post('/document-types', superAdminOnly, documentTypesCrud.add);
router.put('/document-types/:id', superAdminOnly, documentTypesCrud.update);
router.delete('/document-types/:id', superAdminOnly, documentTypesCrud.remove);

// ─── Lead Reject Reasons ──────────────────────────────────────────────────────
router.get('/lead-reject-reasons', leadRejectReasonsCrud.list);
router.post('/lead-reject-reasons', superAdminOnly, leadRejectReasonsCrud.add);
router.put('/lead-reject-reasons/:id', superAdminOnly, leadRejectReasonsCrud.update);
router.delete('/lead-reject-reasons/:id', superAdminOnly, leadRejectReasonsCrud.remove);

// ─── Sales Checklist (Deal Won commitments, verified by Service team) ────────
router.get('/sales-checklist', salesChecklistCrud.list);
router.post('/sales-checklist', superAdminOnly, salesChecklistCrud.add);
router.put('/sales-checklist/:id', superAdminOnly, salesChecklistCrud.update);
router.delete('/sales-checklist/:id', superAdminOnly, salesChecklistCrud.remove);

// ─── Terms & Conditions ───────────────────────────────────────────────────────
router.get('/terms', termsCrud.list);
router.post('/terms', superAdminOnly, termsCrud.add);
router.put('/terms/:id', superAdminOnly, termsCrud.update);
router.delete('/terms/:id', superAdminOnly, termsCrud.remove);

// ─── Additional Charges ───────────────────────────────────────────────────────
router.get('/charges', chargesCrud.list);
router.post('/charges', superAdminOnly, chargesCrud.add);
router.put('/charges/:id', superAdminOnly, chargesCrud.update);
router.delete('/charges/:id', superAdminOnly, chargesCrud.remove);

// ─── Quotation Notes ──────────────────────────────────────────────────────────
router.get('/notes', notesCrud.list);
router.post('/notes', superAdminOnly, notesCrud.add);
router.put('/notes/:id', superAdminOnly, notesCrud.update);
router.delete('/notes/:id', superAdminOnly, notesCrud.remove);

// ─── Dispatch Checklist ───────────────────────────────────────────────────────
router.get('/dispatch-checklist', dispatchChecklistCrud.list);
router.post('/dispatch-checklist', superAdminOnly, dispatchChecklistCrud.add);
router.put('/dispatch-checklist/:id', superAdminOnly, dispatchChecklistCrud.update);
router.delete('/dispatch-checklist/:id', superAdminOnly, dispatchChecklistCrud.remove);

// ─── Quotation Number Settings ────────────────────────────────────────────────
router.get('/quotation-number-settings', quotationNumberSettingsCrud.list);
router.post('/quotation-number-settings', superAdminOnly, quotationNumberSettingsCrud.add);
router.put('/quotation-number-settings/:id', superAdminOnly, quotationNumberSettingsCrud.update);
router.delete('/quotation-number-settings/:id', superAdminOnly, quotationNumberSettingsCrud.remove);

// ─── HRMS: Upload Document Settings ───────────────────────────────────────────
router.get('/hrms-document-types', hrmsDocumentTypesCrud.list);
router.post('/hrms-document-types', superAdminOnly, hrmsDocumentTypesCrud.add);
router.put('/hrms-document-types/:id', superAdminOnly, hrmsDocumentTypesCrud.update);
router.delete('/hrms-document-types/:id', superAdminOnly, hrmsDocumentTypesCrud.remove);

// ─── HRMS: Role Setting ────────────────────────────────────────────────────────
// Left with its original broader write access (Super Admin / HR-Admin /
// Company Admin) — unchanged from before this platform-wide migration.
const canManageRoles = authorizeRoles('Super Admin', 'HR-Admin', 'Company Admin');
router.get('/roles', rolesCrud.list);
router.post('/roles', canManageRoles, rolesCrud.add);
router.put('/roles/:id', canManageRoles, rolesCrud.update);
router.delete('/roles/:id', canManageRoles, rolesCrud.remove);

export default router;
