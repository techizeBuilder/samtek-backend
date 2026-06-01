"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const paymentReminderController_js_1 = require("../controllers/paymentReminderController.js");
const router = express_1.default.Router();
// GET reminder settings for company
router.get('/settings', auth_js_1.authenticateToken, paymentReminderController_js_1.getReminderSettings);
// POST save/update reminder settings
router.post('/settings', auth_js_1.authenticateToken, paymentReminderController_js_1.saveReminderSettings);
// GET overdue & pending invoices
router.get('/overdue', auth_js_1.authenticateToken, paymentReminderController_js_1.getOverdueInvoices);
// POST send manual reminder email
router.post('/send', auth_js_1.authenticateToken, paymentReminderController_js_1.sendManualReminder);
exports.default = router;
