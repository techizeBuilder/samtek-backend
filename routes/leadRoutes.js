import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  createLead,
  getLeads,
  getLeadById,
  getLeadQuotation,
  updateLead,
  deleteLead,
  checkExistingLead,
  getAssignableUsers,
  markLeadAsWon,
  requestPaymentCheck,
  updatePaymentCheckStatus,
  sendLeadToAccount,
  uploadLeadDocuments,
  addLeadDocument,
  // ─── New API Integration Routes ───────────────────────────────
  getApiSettings,
  saveApiSettings,
  syncIndiamartLeads,
  syncIvrLeads,
  receiveIvrCallLog,
  receiveWebsiteWebhook,
  receiveIndiamartWebhook,
  receiveGoogleAdsWebhook,
  verifyFacebookWebhook,
  receiveFacebookWebhook,
  getCallLogs,
  clickToCall
} from '../controllers/leadController.js';
import { scheduleMeeting, getMeeting, getMeetings, completeMeeting } from '../controllers/meetingController.js';
import { leadDocumentUpload } from '../middleware/leadDocumentUpload.js';
import { checkPermission, checkAnyPermission } from '../middleware/permissions.js';

const router = express.Router();

// ─── Public Webhook Routes (No Auth — called by external services) ───────────
router.post('/ivr-webhook',        receiveIvrCallLog);
router.post('/website-webhook',    receiveWebsiteWebhook);
router.post('/indiamart-webhook',  receiveIndiamartWebhook);
router.post('/google-ads-webhook', receiveGoogleAdsWebhook);
router.get('/facebook-webhook',    verifyFacebookWebhook);
router.post('/facebook-webhook',   receiveFacebookWebhook);

// ─── Authenticated Routes ─────────────────────────────────────────────────────
router.use(authenticateToken);

const leadsView = checkPermission('sales', 'leads', 'view');
const leadsAdd = checkPermission('sales', 'leads', 'add');
const leadsEdit = checkPermission('sales', 'leads', 'edit');
const leadsDelete = checkPermission('sales', 'leads', 'delete');

// GET / (getLeads) and the payment-check update are also used by Accounts —
// the Payment Verifications page (module 'accounts', feature 'sales', same
// grant as leadPaymentRoutes.js) lists leads via this same endpoint and
// updates their paymentCheckStatus. Either grant is enough to pass these two
// routes; the controller itself already scopes what Accounts users can
// see/do (see getLeads' isAccounts handling and updatePaymentCheckStatus).
// Other lead routes stay on the plain sales.leads check.
const leadOrAccountsSales = [['sales', 'leads'], ['accounts', 'sales']];
const leadsViewOrAccountsSales = checkAnyPermission(leadOrAccountsSales, 'view');
const paymentCheckEdit = checkAnyPermission(leadOrAccountsSales, 'edit');

router.post('/',                          leadsAdd, createLead);
router.get('/',                           leadsViewOrAccountsSales, getLeads);
router.get('/check',                      leadsView, checkExistingLead);
router.get('/users',                      leadsView, getAssignableUsers);

// API Settings
router.get('/api-settings',              leadsView, getApiSettings);
router.post('/api-settings',             leadsEdit, saveApiSettings);

// Sync Routes
router.post('/sync-indiamart',           leadsAdd, syncIndiamartLeads);
router.post('/sync-ivr',                 leadsAdd, syncIvrLeads);
router.post('/click-to-call',            leadsEdit, clickToCall);

// Lead-specific routes
router.get('/:id/quotation',              leadsView, getLeadQuotation);
router.get('/:id',                        leadsView, getLeadById);
router.put('/:id',                        leadsEdit, updateLead);
router.put('/:id/payment-check',          paymentCheckEdit, updatePaymentCheckStatus);
router.post('/:id/request-payment-check', leadsEdit, requestPaymentCheck);
router.post('/:id/send-to-account',       leadsEdit, sendLeadToAccount);
router.post('/:id/upload-documents',      leadsEdit, leadDocumentUpload.fields([
  { name: 'po', maxCount: 1 },
  { name: 'paymentProof', maxCount: 1 },
  { name: 'quotation', maxCount: 1 }
]), uploadLeadDocuments);
router.post('/:id/add-document',          leadsEdit, leadDocumentUpload.single('file'), addLeadDocument);
router.post('/:id/won',                   leadsEdit, markLeadAsWon);
router.delete('/:id',                     leadsDelete, deleteLead);
router.get('/:id/call-logs',              leadsView, getCallLogs);

// Meeting routes
router.post('/:id/meeting',              leadsAdd, scheduleMeeting);
router.put('/:id/meeting',               leadsEdit, scheduleMeeting);
router.get('/:id/meeting',               leadsView, getMeeting);
router.get('/:id/meetings',              leadsView, getMeetings);
router.put('/:id/meeting/:meetingId/complete', leadsEdit, completeMeeting);

export default router;

