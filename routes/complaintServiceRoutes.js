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

import { serviceUpload } from '../middleware/complaintServiceUpload.js';

const router = express.Router();

// =========================================================================
// 🔓 PUBLIC ROUTE (Notice: No authenticateToken here!)
// =========================================================================
router.post('/verify-response/:token', verifyCustomerResponse);


// =========================================================================
// 🔒 PROTECTED ROUTES (authenticateToken added explicitly to each)
// =========================================================================

router.get('/tickets/:id/invoice', authenticateToken, generateServiceInvoice);

// Customer history & Technician list
router.get('/purchase-history/:mobileNumber', authenticateToken, getCustomerHistory);
router.get('/servicemen', authenticateToken, getServicemen);

// Ticket creation and complaint registration route
router.post('/create-ticket', authenticateToken, authorizeRoles("HR-Admin"), createSupportTicket);
router.get('/tickets', authenticateToken, getSupportTickets);
router.get('/tickets/:id', authenticateToken, getTicketDetails);
router.put('/tickets/:id/assign', authenticateToken, assignTicket);
router.put('/tickets/:id/cancel', authenticateToken, cancelTicket);

// Dispatcher triggers the verification email
router.post('/tickets/:id/send-verification', authenticateToken, sendVerificationEmail);

// Technician routes
router.get('/technician/tickets', authenticateToken, getMyTickets);
router.put('/technician/start-visit/:id', authenticateToken, startVisit);
router.put(
    '/technician/complete-visit/:id', 
    authenticateToken, // Protected
    serviceUpload.array('media', 5), 
    completeVisit
);

export default router;