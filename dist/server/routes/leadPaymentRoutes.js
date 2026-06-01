"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const leadPaymentController_js_1 = require("../controllers/leadPaymentController.js");
const router = express_1.default.Router();
router.use(auth_js_1.authenticateToken);
// Get leads sent to account for payment processing
router.get('/leads', leadPaymentController_js_1.getLeadsForPayment);
// Get bank accounts for payment selection
router.get('/bank-accounts', leadPaymentController_js_1.getBankAccounts);
// Add advanced payment for a lead
router.post('/', leadPaymentController_js_1.addLeadPayment);
// Get all lead payments
router.get('/', leadPaymentController_js_1.getLeadPayments);
// Get payment summary for a specific lead
router.get('/lead/:leadId', leadPaymentController_js_1.getLeadPaymentSummary);
// Update payment status (verify/reject)
router.put('/:id/status', leadPaymentController_js_1.updateLeadPaymentStatus);
exports.default = router;
