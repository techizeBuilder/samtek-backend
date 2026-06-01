"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const ComplaintServiceController_js_1 = require("../controllers/ComplaintServiceController.js");
const ServiceDispatchController_js_1 = require("../controllers/ServiceDispatchController.js");
const complaintServiceUpload_js_1 = require("../middleware/complaintServiceUpload.js");
const router = express_1.default.Router();
// =========================================================================
// 🔓 PUBLIC ROUTE (Notice: No authenticateToken here!)
// =========================================================================
router.post('/verify-response/:token', ComplaintServiceController_js_1.verifyCustomerResponse);
// =========================================================================
// 🔒 PROTECTED ROUTES (authenticateToken & authorizeRoles added)
// =========================================================================
// --- 1. SHARED ROUTES (Both Dispatchers and Technicians can access) ---
// Both roles need to view the specific details of a ticket and download invoices
router.get('/tickets/:id', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Head', 'Complaint Management Employee'), ComplaintServiceController_js_1.getTicketDetails);
router.get('/tickets/:id/invoice', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Head', 'Complaint Management Employee'), ComplaintServiceController_js_1.generateServiceInvoice);
// --- 2. HEAD / DISPATCHER ROUTES (Web Dashboard) ---
// Only the Head can create, assign, view the global list, cancel, and verify tickets
router.get('/purchase-history/:mobileNumber', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Head'), ComplaintServiceController_js_1.getCustomerHistory);
router.get('/servicemen', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Head'), ComplaintServiceController_js_1.getServicemen);
router.post('/create-ticket', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Head'), ComplaintServiceController_js_1.createSupportTicket);
router.get('/tickets', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Head'), ComplaintServiceController_js_1.getSupportTickets);
router.put('/tickets/:id/assign', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Head'), ComplaintServiceController_js_1.assignTicket);
router.put('/tickets/:id/cancel', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Head'), ComplaintServiceController_js_1.cancelTicket);
router.post('/tickets/:id/send-verification', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Head'), ComplaintServiceController_js_1.sendVerificationEmail);
router.put('/servicemen/:id', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Head'), ComplaintServiceController_js_1.updateTechnicianProfile);
// --- 3. EMPLOYEE / TECHNICIAN ROUTES (Mobile App) ---
// Only the Employee can view their specific task list and execute visits
router.get('/technician/tickets', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Employee'), ComplaintServiceController_js_1.getMyTickets);
router.put('/technician/start-visit/:id', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Employee'), ComplaintServiceController_js_1.startVisit);
router.put('/technician/complete-visit/:id', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Employee'), // Protected by role
complaintServiceUpload_js_1.serviceUpload.array('media', 5), ComplaintServiceController_js_1.completeVisit);
// --- 4. DISPATCH ORDERS FOR SERVICE ---
router.get('/dispatched-orders', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Head', 'Complaint Management Employee'), ServiceDispatchController_js_1.getDispatchedOrders);
router.put('/dispatched-orders/:id/customer-confirmation', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Head', 'Complaint Management Employee'), ServiceDispatchController_js_1.updateCustomerConfirmation);
router.put('/dispatched-orders/:id/installation-schedule', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Head', 'Complaint Management Employee'), ServiceDispatchController_js_1.updateInstallationSchedule);
router.put('/dispatched-orders/:id/feedback', auth_js_1.authenticateToken, (0, auth_js_1.authorizeRoles)('Complaint Management Head', 'Complaint Management Employee'), ServiceDispatchController_js_1.updateFeedbackAndRatings);
exports.default = router;
