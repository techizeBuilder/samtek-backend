import express from "express";
import { authenticateToken, authorizeRoles } from "../middleware/auth.js";
import {
    assignTicket,
    cancelTicket,
    completeVisit,
    createSupportTicket,
    getCustomerHistory,
    getMyTickets,
    getServicemen,
    getSupportTickets,
    getTicketDetails,
    startVisit,
    sendVerificationEmail,
    verifyCustomerResponse,
    generateServiceInvoice,
    updateTechnicianProfile
} from "../controllers/ComplaintServiceController.js";

import {
    getDispatchedOrders,
    updateCustomerConfirmation,
    updateInstallationSchedule,
    updateFeedbackAndRatings,
    bulkUpdateCustomerConfirmation,
    bulkUpdateInstallationSchedule,
    bulkUpdateFeedbackAndRatings,
    getFeedbackByToken,
    submitFeedbackByToken
} from "../controllers/ServiceDispatchController.js";

import { serviceUpload } from '../middleware/complaintServiceUpload.js';
import {
  getComplaintExpenseCategories,
  createComplaintExpense,
  getComplaintExpenses,
  getComplaintExpenseSummary,
  updateComplaintExpense,
  deleteComplaintExpense,
} from '../controllers/complaintExpenseController.js';

const router = express.Router();

// =========================================================================
// 🔓 PUBLIC ROUTE (Notice: No authenticateToken here!)
// =========================================================================
router.post('/verify-response/:token', verifyCustomerResponse);

// PUBLIC: Customer feedback form via emailed link
router.get('/feedback/:token', getFeedbackByToken);
router.post('/feedback/:token', submitFeedbackByToken);


// =========================================================================
// 🔒 PROTECTED ROUTES (authenticateToken & authorizeRoles added)
// =========================================================================

// --- 1. SHARED ROUTES (Both Dispatchers and Technicians can access) ---
// Both roles need to view the specific details of a ticket and download invoices
router.get('/tickets/:id', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), getTicketDetails);
router.get('/tickets/:id/invoice', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), generateServiceInvoice);

// --- 2. HEAD / DISPATCHER ROUTES (Web Dashboard) ---
// Only the Head can create, assign, view the global list, cancel, and verify tickets
router.get('/purchase-history/:mobileNumber', authenticateToken, authorizeRoles('Complaint Management Head'), getCustomerHistory);
router.get('/servicemen', authenticateToken, authorizeRoles('Complaint Management Head'), getServicemen);
router.post('/create-ticket', authenticateToken, authorizeRoles('Complaint Management Head'), createSupportTicket);
router.get('/tickets', authenticateToken, authorizeRoles('Complaint Management Head'), getSupportTickets);
router.put('/tickets/:id/assign', authenticateToken, authorizeRoles('Complaint Management Head'), assignTicket);
router.put('/tickets/:id/cancel', authenticateToken, authorizeRoles('Complaint Management Head'), cancelTicket);
router.post('/tickets/:id/send-verification', authenticateToken, authorizeRoles('Complaint Management Head'), sendVerificationEmail);
router.put('/servicemen/:id', authenticateToken, authorizeRoles('Complaint Management Head'), updateTechnicianProfile);

// --- 3. EMPLOYEE / TECHNICIAN ROUTES (Mobile App) ---
// Only the Employee can view their specific task list and execute visits
router.get('/technician/tickets', authenticateToken, authorizeRoles('Complaint Management Employee'), getMyTickets);
router.put('/technician/start-visit/:id', authenticateToken, authorizeRoles('Complaint Management Employee'), startVisit);
router.put(
    '/technician/complete-visit/:id',
    authenticateToken,
    authorizeRoles('Complaint Management Employee'), // Protected by role
    serviceUpload.array('media', 5),
    completeVisit
);

// --- 4. DISPATCH ORDERS FOR SERVICE ---
router.get('/dispatched-orders', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), getDispatchedOrders);

// Bulk (whole-order) variants — MUST be registered before the `:id` routes
// below, since `/dispatched-orders/bulk/...` would otherwise be matched by
// `/dispatched-orders/:id/...` with id="bulk". One order's machines travel
// and get serviced together, so Complaint Management acts on all of them in
// one call instead of repeating the same confirmation/schedule/feedback once
// per machine.
router.put('/dispatched-orders/bulk/customer-confirmation', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), bulkUpdateCustomerConfirmation);
router.put('/dispatched-orders/bulk/installation-schedule', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), bulkUpdateInstallationSchedule);
router.put('/dispatched-orders/bulk/feedback', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), bulkUpdateFeedbackAndRatings);

router.put('/dispatched-orders/:id/customer-confirmation', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), updateCustomerConfirmation);
router.put('/dispatched-orders/:id/installation-schedule', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), updateInstallationSchedule);
router.put('/dispatched-orders/:id/feedback', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), updateFeedbackAndRatings);

// --- 5. SERVICE & COMPLAINT EXPENSES (installation, traveling) ---
router.get('/expenses/categories', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), getComplaintExpenseCategories);
router.get('/expenses/summary', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), getComplaintExpenseSummary);
router.get('/expenses', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), getComplaintExpenses);
router.post('/expenses', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), createComplaintExpense);
router.put('/expenses/:id', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), updateComplaintExpense);
router.delete('/expenses/:id', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), deleteComplaintExpense);

export default router;