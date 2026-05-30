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
    generateServiceInvoice
} from "../controllers/ComplaintServiceController.js";

import { 
    getDispatchedOrders, 
    updateCustomerConfirmation, 
    updateInstallationSchedule, 
    updateFeedbackAndRatings 
} from "../controllers/ServiceDispatchController.js";

import { serviceUpload } from '../middleware/complaintServiceUpload.js';

const router = express.Router();

// =========================================================================
// 🔓 PUBLIC ROUTE (Notice: No authenticateToken here!)
// =========================================================================
router.post('/verify-response/:token', verifyCustomerResponse);


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
router.put('/dispatched-orders/:id/customer-confirmation', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), updateCustomerConfirmation);
router.put('/dispatched-orders/:id/installation-schedule', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), updateInstallationSchedule);
router.put('/dispatched-orders/:id/feedback', authenticateToken, authorizeRoles('Complaint Management Head', 'Complaint Management Employee'), updateFeedbackAndRatings);

export default router;