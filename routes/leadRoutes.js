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
  getCallLogs,
  clickToCall
} from '../controllers/leadController.js';
import { scheduleMeeting, getMeeting } from '../controllers/meetingController.js';
import { leadDocumentUpload } from '../middleware/leadDocumentUpload.js';

const router = express.Router();

// ─── Public Webhook Routes (No Auth — called by external services) ───────────
router.post('/ivr-webhook',      receiveIvrCallLog);
router.post('/website-webhook',  receiveWebsiteWebhook);

// ─── Authenticated Routes ─────────────────────────────────────────────────────
router.use(authenticateToken);

router.post('/',                          createLead);
router.get('/',                           getLeads);
router.get('/check',                      checkExistingLead);
router.get('/users',                      getAssignableUsers);

// API Settings
router.get('/api-settings',              getApiSettings);
router.post('/api-settings',             saveApiSettings);

// Sync Routes
router.post('/sync-indiamart',           syncIndiamartLeads);
router.post('/sync-ivr',                 syncIvrLeads);
router.post('/click-to-call',            clickToCall);

// Lead-specific routes
router.get('/:id/quotation',              getLeadQuotation);
router.get('/:id',                        getLeadById);
router.put('/:id',                        updateLead);
router.put('/:id/payment-check',          updatePaymentCheckStatus);
router.post('/:id/request-payment-check', requestPaymentCheck);
router.post('/:id/send-to-account',       sendLeadToAccount);
router.post('/:id/upload-documents',      leadDocumentUpload.fields([
  { name: 'po', maxCount: 1 },
  { name: 'paymentProof', maxCount: 1 },
  { name: 'quotation', maxCount: 1 }
]), uploadLeadDocuments);
router.post('/:id/add-document',          leadDocumentUpload.single('file'), addLeadDocument);
router.post('/:id/won',                   markLeadAsWon);
router.delete('/:id',                     deleteLead);
router.get('/:id/call-logs',              getCallLogs);

// Meeting routes
router.post('/:id/meeting',              scheduleMeeting);
router.put('/:id/meeting',               scheduleMeeting);
router.get('/:id/meeting',               getMeeting);

export default router;

