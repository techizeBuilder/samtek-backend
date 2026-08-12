import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
    getReminderSettings,
    saveReminderSettings,
    getOverdueInvoices,
    sendManualReminder
} from '../controllers/paymentReminderController.js';

const router = express.Router();

const bankAndCashView = checkPermission('accounts', 'bankAndCash', 'view');
const bankAndCashEdit = checkPermission('accounts', 'bankAndCash', 'edit');

// GET reminder settings for company
router.get('/settings', authenticateToken, bankAndCashView, getReminderSettings);

// POST save/update reminder settings
router.post('/settings', authenticateToken, bankAndCashEdit, saveReminderSettings);

// GET overdue & pending invoices
router.get('/overdue', authenticateToken, bankAndCashView, getOverdueInvoices);

// POST send manual reminder email
router.post('/send', authenticateToken, bankAndCashEdit, sendManualReminder);

export default router;
