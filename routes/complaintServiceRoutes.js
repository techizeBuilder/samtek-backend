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
import { checkPermission } from '../middleware/permissions.js';

const router = express.Router();

// roleModulesConfig.js MODULES['complaints'].features = dashboard,
// supportManagement, technicians, customerRecords, dealVerifications,
// deliveryConfirmation, installationSchedule, feedbackRatings, expenses.
const supportView = checkPermission('complaints', 'supportManagement', 'view');
const supportAdd = checkPermission('complaints', 'supportManagement', 'add');
const supportEdit = checkPermission('complaints', 'supportManagement', 'edit');

const techniciansView = checkPermission('complaints', 'technicians', 'view');
const techniciansEdit = checkPermission('complaints', 'technicians', 'edit');

const customerRecordsView = checkPermission('complaints', 'customerRecords', 'view');

const dealVerificationsEdit = checkPermission('complaints', 'dealVerifications', 'edit');

const deliveryConfirmationView = checkPermission('complaints', 'deliveryConfirmation', 'view');
const deliveryConfirmationEdit = checkPermission('complaints', 'deliveryConfirmation', 'edit');

const installationScheduleEdit = checkPermission('complaints', 'installationSchedule', 'edit');

const feedbackRatingsEdit = checkPermission('complaints', 'feedbackRatings', 'edit');

const expensesView = checkPermission('complaints', 'expenses', 'view');
const expensesAdd = checkPermission('complaints', 'expenses', 'add');
const expensesEdit = checkPermission('complaints', 'expenses', 'edit');
const expensesDelete = checkPermission('complaints', 'expenses', 'delete');

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
router.get('/tickets/:id', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), supportView, getTicketDetails);
router.get('/tickets/:id/invoice', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), supportView, generateServiceInvoice);

// --- 2. HEAD / DISPATCHER ROUTES (Web Dashboard) ---
// Only the Head can create, assign, view the global list, cancel, and verify tickets
router.get('/purchase-history/:mobileNumber', authenticateToken, authorizeRoles('Complaint Management Head'), customerRecordsView, getCustomerHistory);
router.get('/servicemen', authenticateToken, authorizeRoles('Complaint Management Head'), techniciansView, getServicemen);
router.post('/create-ticket', authenticateToken, authorizeRoles('Complaint Management Head'), supportAdd, createSupportTicket);
router.get('/tickets', authenticateToken, authorizeRoles('Complaint Management Head'), supportView, getSupportTickets);
router.put('/tickets/:id/assign', authenticateToken, authorizeRoles('Complaint Management Head'), techniciansEdit, assignTicket);
router.put('/tickets/:id/cancel', authenticateToken, authorizeRoles('Complaint Management Head'), supportEdit, cancelTicket);
router.post('/tickets/:id/send-verification', authenticateToken, authorizeRoles('Complaint Management Head'), dealVerificationsEdit, sendVerificationEmail);
router.put('/servicemen/:id', authenticateToken, authorizeRoles('Complaint Management Head'), techniciansEdit, updateTechnicianProfile);

// --- 3. EMPLOYEE / TECHNICIAN ROUTES (Mobile App) ---
// Only the Employee can view their specific task list and execute visits
router.get('/technician/tickets', authenticateToken, authorizeRoles('Complaint Management Employee'), supportView, getMyTickets);
router.put('/technician/start-visit/:id', authenticateToken, authorizeRoles('Complaint Management Employee'), supportEdit, startVisit);
router.put(
    '/technician/complete-visit/:id',
    authenticateToken,
    authorizeRoles('Complaint Management Employee'), // Protected by role
    supportEdit,
    serviceUpload.array('media', 5),
    completeVisit
);

// --- 4. DISPATCH ORDERS FOR SERVICE ---
router.get('/dispatched-orders', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), deliveryConfirmationView, getDispatchedOrders);

// Bulk (whole-order) variants — MUST be registered before the `:id` routes
// below, since `/dispatched-orders/bulk/...` would otherwise be matched by
// `/dispatched-orders/:id/...` with id="bulk". One order's machines travel
// and get serviced together, so Complaint Management acts on all of them in
// one call instead of repeating the same confirmation/schedule/feedback once
// per machine.
router.put('/dispatched-orders/bulk/customer-confirmation', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), deliveryConfirmationEdit, bulkUpdateCustomerConfirmation);
router.put('/dispatched-orders/bulk/installation-schedule', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), installationScheduleEdit, bulkUpdateInstallationSchedule);
router.put('/dispatched-orders/bulk/feedback', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), feedbackRatingsEdit, bulkUpdateFeedbackAndRatings);

router.put('/dispatched-orders/:id/customer-confirmation', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), deliveryConfirmationEdit, updateCustomerConfirmation);
router.put('/dispatched-orders/:id/installation-schedule', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), installationScheduleEdit, updateInstallationSchedule);
router.put('/dispatched-orders/:id/feedback', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), feedbackRatingsEdit, updateFeedbackAndRatings);

// --- 5. SERVICE & COMPLAINT EXPENSES (installation, traveling) ---
router.get('/expenses/categories', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), expensesView, getComplaintExpenseCategories);
router.get('/expenses/summary', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), expensesView, getComplaintExpenseSummary);
router.get('/expenses', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), expensesView, getComplaintExpenses);
router.post('/expenses', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), expensesAdd, createComplaintExpense);
router.put('/expenses/:id', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), expensesEdit, updateComplaintExpense);
router.delete('/expenses/:id', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), expensesDelete, deleteComplaintExpense);

export default router;