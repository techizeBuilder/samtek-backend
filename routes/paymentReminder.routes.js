import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
    getReminderSettings,
    saveReminderSettings,
    getOverdueInvoices,
    sendManualReminder
} from '../controllers/paymentReminderController.js';

const router = express.Router();

// GET reminder settings for company
router.get('/settings', authenticateToken, getReminderSettings);

// POST save/update reminder settings
router.post('/settings', authenticateToken, saveReminderSettings);

// GET overdue & pending invoices
router.get('/overdue', authenticateToken, getOverdueInvoices);

// POST send manual reminder email
router.post('/send', authenticateToken, sendManualReminder);

export default router;
