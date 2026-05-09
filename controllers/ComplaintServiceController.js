import ServiceTicket from '../models/ComplaintServiceModel.js';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { Item } from '../models/Inventory.js'; // Adjust path if necessary
import { sendCommonEmail } from '../utils/email.js'; // Mock email sender

// --- DUMMY DATA ---
const dummyPurchaseHistory = [
    {
        customerName: "TechCorp Industries",
        mobileNumber: "9876543210",
        address: "123 Silicon Valley Road, Sector 4",
        email: "techcorp@example.com",
        pastPurchases: [
            {
                machineType: "Industrial CNC Router",
                model: "CNC-Pro 5000",
                serialNumber: "SN-1002938",
                purchaseDate: "2024-01-15",
                warrantyStatus: "Active",
                amcStatus: "Valid until Jan 2027"
            },
            {
                machineType: "Laser Cutter",
                model: "LC-200X",
                serialNumber: "SN-8847291",
                purchaseDate: "2021-05-20",
                warrantyStatus: "Expired",
                amcStatus: "Not Subscribed"
            }
        ]
    },
    {
        customerName: "Global Print Works",
        mobileNumber: "9988776655",
        address: "45 Industrial Estate, North Zone",
        email: "globalprint@example.com",
        pastPurchases: [
            {
                machineType: "Commercial Printer",
                model: "PrintMaster V8",
                serialNumber: "SN-5566778",
                purchaseDate: "2025-11-10",
                warrantyStatus: "Active",
                amcStatus: "Valid until Nov 2028"
            }
        ]
    }
];

const dummyTechnicians = [
    {
        _id: "69eeea9e9df214b658e38edf",
        name: "Rahul Sharma",
        role: "Technician",
        contact: "9123456780",
        skills: ["Breakdown", "Installation"],
        serviceZone: "North Zone",
        currentStatus: "Available",
        companyId: "69ea063b78220d106638b0ef"
    },
    {
        _id: "60d5ecb8b392d7001f222222",
        name: "Anita Desai",
        role: "Technician",
        contact: "9123456781",
        skills: ["Performance Issue", "Training"],
        serviceZone: "Sector 4",
        currentStatus: "On Job",
        companyId: "69ea063b78220d106638b0ef"
    },
    {
        _id: "60d5ecb8b392d7001f333333",
        name: "Vikram Singh",
        role: "Technician",
        contact: "9123456782",
        skills: ["Breakdown", "Performance Issue", "Installation", "Training"],
        serviceZone: "All",
        currentStatus: "Available",
        companyId: "69ea063b78220d106638b0ef"
    }
];

// --- CONTROLLERS ---

// 1. Get Customer History
export const getCustomerHistory = async (req, res) => {
    try {
        const { mobileNumber } = req.params;

        // 1. Fetch Real Previous Complaints from the database
        const previousTickets = await ServiceTicket.find({
            "customer.mobileNumber": mobileNumber,
            companyId: req.user.companyId
        })
            .select('tokenId status createdAt issue.issueType')
            .sort({ createdAt: -1 })
            .limit(5); // Just show the last 5 for quick reference

        // 2. Fetch Dummy Purchase/Warranty/AMC data[cite: 1, 2]
        const purchaseData = dummyPurchaseHistory.find(
            (customer) => customer.mobileNumber === mobileNumber
        );

        if (!purchaseData && previousTickets.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No history found for this number.'
            });
        }

        res.status(200).json({
            success: true,
            data: {
                ...purchaseData, // Name, Address, Purchases
                previousComplaints: previousTickets // Real DB data
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

import User from '../models/User.js'; // Ensure this is imported at the top of ComplaintServiceController.js

// 2. Get Servicemen list (Real Database Fetch)
export const getServicemen = async (req, res) => {
    try {
        const { status } = req.query;

        // 1. Security Check
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Missing Company ID' });
        }

        // 2. Fetch real technicians from the database for this specific company
        const users = await User.find({
            companyId: req.user.companyId,
            isActive: true,
            // Assuming these are the roles that act as technicians in your system
            role: { $in: ['Employee', 'Technician'] }
        });

        // 3. Map the User documents to match the exact structure the frontend expects
        let technicians = users.map(user => ({
            _id: user._id,
            name: user.fullName || user.username,
            role: user.role,
            contact: user.mobile || 'N/A',
            // Defaulting skills and zone since they might not be in your base User schema yet
            skills: ["Breakdown", "Installation", "Performance Issue", "Training"],
            serviceZone: user.unit || "All",
            currentStatus: "Available", // Hardcoded to available for now
            companyId: user.companyId
        }));

        // 4. Apply status filter if the frontend requested it
        if (status) {
            technicians = technicians.filter(
                (tech) => tech.currentStatus === status
            );
        }

        // 5. Send Response
        res.status(200).json({
            success: true,
            count: technicians.length,
            data: technicians
        });

    } catch (error) {
        console.error('Error fetching servicemen:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching technicians.' });
    }
};

// 3. Create Support Ticket
export const createSupportTicket = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized: Missing Company ID in token'
            });
        }

        // 2. Extract payload from frontend form
        const {
            source,        // String: 'Call', 'WhatsApp', 'Website', 'Sales Team'

            customer,
            // Expected shape: { name: String, mobileNumber: String, email: String, address: String }

            machine,
            // Expected shape: { machineType: String, model: String, serialNumber: String }

            issue,
            // Expected shape: { issueType: String (Breakdown, Performance Issue, etc.), description: String }

            priorityLevel  // String: 'Low', 'Medium', 'High'
        } = req.body;

        if (!customer?.name || !customer?.mobileNumber || !customer?.address) {
            return res.status(400).json({ success: false, message: 'Missing required customer details.' });
        }
        customer.mobileNumber = customer.mobileNumber.replace(/\D/g, '').slice(-10);
        const mobileRegex = /^[0-9]{10}$/;
        if (!mobileRegex.test(customer.mobileNumber)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid mobile number format. It must be exactly 10 numeric digits.'
            });
        }
        if (!machine?.machineType) {
            return res.status(400).json({ success: false, message: 'Missing machine type.' });
        }
        if(!machine.serialNumber || !machine.model || !machine.warrantyStatus || !machine.amcStatus) {
            return res.status(400).json({ success: false, message: 'Missing required machine details.' });
        }
        if (!issue?.issueType) {
            return res.status(400).json({ success: false, message: 'Missing issue type.' });
        }


        const timePart = Date.now().toString(36).toUpperCase();
        const randomPart = crypto.randomBytes(2).toString('hex').toUpperCase();
        const generatedToken = `TKT-${timePart}-${randomPart}`;

        const now = new Date();
        let resolutionDeadline;

        if (priorityLevel === 'High') {
            resolutionDeadline = new Date(now.getTime() + (24 * 60 * 60 * 1000));
        } else if (priorityLevel === 'Medium') {
            resolutionDeadline = new Date(now.getTime() + (48 * 60 * 60 * 1000));
        } else {
            // Default 72 hours for Low Priority
            resolutionDeadline = new Date(now.getTime() + (72 * 60 * 60 * 1000));
        }

        const newTicket = await ServiceTicket.create({
            tokenId: generatedToken,
            source: source || 'Call',
            companyId: req.user.companyId,
            createdBy: req.user._id,
            customer,
            machine: {
                machineType: machine.machineType,
                model: machine.model,
                serialNumber: machine.serialNumber,
                warrantyStatus: machine.warrantyStatus || 'Unknown',
                amcStatus: machine.amcStatus || 'Unknown'
            },
            issue,
            priority: {
                level: priorityLevel || 'Low'
            },
            sla: {
                responseDeadline: new Date(now.getTime() + (2 * 60 * 60 * 1000)),
                resolutionDeadline: resolutionDeadline,
                isBreached: false
            },
            status: 'Unassigned',
            auditLog: [{
                action: 'Ticket Created',
                performedBy: {
                    userId: req.user._id,
                    role: req.user.role
                },
                newStatus: 'Unassigned'
            }]
        });

        await newTicket.populate([
            { path: 'createdBy', select: 'username fullName role email' },
            { path: 'auditLog.performedBy.userId', select: 'username fullName' }
        ]);

        res.status(201).json({
            success: true,
            message: 'Ticket created successfully',
            data: newTicket
        });

    } catch (error) {
        console.error('Error creating support ticket:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while creating ticket.'
        });
    }
};

// 4. Get Support Tickets (Dashboard List)
export const getSupportTickets = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Missing Company ID' });
        }

        const query = { companyId: req.user.companyId };

        // FUTURE: if (req.user.role === 'Technician') query['assignment.technicianId'] = req.user._id;

        const {
            page = 1,
            limit = 10,
            status,
            priority,
            isBreached,
            search,
            startDate,
            endDate,
            technicianId,
            issueType
        } = req.query;

        if (status) query.status = status;
        if (priority) query['priority.level'] = priority;

        if (isBreached !== undefined) {
            query['sla.isBreached'] = isBreached === 'true';
        }

        if (issueType) query['issue.issueType'] = issueType;
        if (technicianId) {
            if (technicianId === 'unassigned') {
                query['assignment.technicianId'] = null;
            } else {
                query['assignment.technicianId'] = technicianId;
            }
        }
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) {
                query.createdAt.$gte = new Date(new Date(startDate).setHours(0, 0, 0, 0));
            }
            if (endDate) {
                query.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
            }
        }

        if (search) {
            query.$or = [
                { tokenId: { $regex: search, $options: 'i' } },
                { 'customer.mobileNumber': { $regex: search, $options: 'i' } },
                { 'customer.name': { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const parsedLimit = parseInt(limit);

        const tickets = await ServiceTicket.find(query)
            .select('-auditLog -visitHistory') // Optmized payload

            //THE FIX: Breached tickets at the very top, then sort the rest by NEWEST first
            .sort({ 'sla.isBreached': -1, createdAt: -1 })

            .skip(skip)
            .limit(parsedLimit)
            .populate('createdBy', 'username fullName role email')
            .populate('assignment.technicianId', 'username fullName mobile');

        const totalTickets = await ServiceTicket.countDocuments(query);

        // Calculate Average Resolution Time
        const metricQuery = { ...query, status: 'Resolved' };
        const resolutionStats = await ServiceTicket.aggregate([
            { $match: metricQuery },
            { $group: { _id: null, averageMinutes: { $avg: "$closure.resolutionTimeMinutes" } } }
        ]);

        const avgResolutionMinutes = resolutionStats.length > 0
            ? Math.round(resolutionStats[0].averageMinutes)
            : 0;

        // NEW: Calculate Issue Type Breakdown across ALL matched tickets (ignoring pagination)
        const issueTypeStats = await ServiceTicket.aggregate([
            { $match: query }, // Match current filters (companyId, dates, etc.)
            { $group: { _id: "$issue.issueType", count: { $sum: 1 } } }
        ]);

        // Format it nicely for the frontend pie chart
        const formattedIssueStats = issueTypeStats.map(stat => ({
            name: stat._id || 'Other',
            value: stat.count
        }));

        res.status(200).json({
            success: true,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalTickets / parsedLimit),
                totalTickets,
                limit: parsedLimit
            },
            metrics: {
                averageResolutionTime: `${avgResolutionMinutes} minutes`,
                issueTypeBreakdown: formattedIssueStats
            },
            data: tickets
        });

    } catch (error) {
        console.error('Error fetching support tickets:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching tickets.' });
    }
};

// 5. Assign Ticket
export const assignTicket = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Missing Company ID' });
        }

        const { id } = req.params;
        const { technicianId, visitScheduledAt } = req.body;

        if (!technicianId) {
            return res.status(400).json({ success: false, message: 'Technician ID is required.' });
        }
        if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(technicianId)) {
            return res.status(400).json({ success: false, message: 'Invalid Ticket or Technician ID format.' });
        }

        if (visitScheduledAt) {
            const scheduledDate = new Date(visitScheduledAt);
            if (isNaN(scheduledDate.getTime())) {
                return res.status(400).json({ success: false, message: 'Invalid visitScheduledAt date format.' });
            }
            if (scheduledDate < new Date()) {
                return res.status(400).json({ success: false, message: 'Visit cannot be scheduled in the past.' });
            }
        }

        const technician = await User.findOne({
            _id: technicianId,
            companyId: req.user.companyId,
            // role: 'Technician' // Uncomment once role is confirmed
        });

        if (!technician) {
            return res.status(404).json({
                success: false,
                message: 'Technician not found, does not belong to your company, or lacks proper role.'
            });
        }

        const ticket = await ServiceTicket.findOne({
            _id: id,
            companyId: req.user.companyId
        });

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found.' });
        }

        if (['Resolved', 'Cancelled'].includes(ticket.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot assign a ticket that is already ${ticket.status}.`
            });
        }

        const previousStatus = ticket.status;
        const isReassignment = !!ticket.assignment?.technicianId;

        if (!ticket.assignment) ticket.assignment = {};
        ticket.assignment.technicianId = technicianId;
        ticket.assignment.assignedAt = new Date();
        ticket.assignment.visitScheduledAt = visitScheduledAt ? new Date(visitScheduledAt) : null;

        if (ticket.status === 'Unassigned') {
            ticket.status = 'Pending';
        }

        const techName = technician.fullName || technician.username;
        const actionText = isReassignment
            ? `Ticket Reassigned to ${techName}`
            : `Ticket Assigned to ${techName}`;

        ticket.auditLog.push({
            action: actionText,
            performedBy: {
                userId: req.user._id,
                role: req.user.role
            },
            previousStatus: previousStatus,
            newStatus: ticket.status
        });

        // Save to Database
        await ticket.save();

        //  Populate response 
        // (We removed the auditLog population to save database resources!)
        await ticket.populate([
            { path: 'createdBy', select: 'username fullName role email' },
            { path: 'assignment.technicianId', select: 'username fullName mobile' }
        ]);

        //  Strip the heavy arrays before sending to the frontend
        // We convert the Mongoose document to a plain JS object so we can delete keys
        const responseData = ticket.toObject();
        delete responseData.auditLog;
        delete responseData.visitHistory;

        //  Send Success Response
        res.status(200).json({
            success: true,
            message: actionText,
            data: responseData
        });

    } catch (error) {
        console.error('Error assigning ticket:', error);
        res.status(500).json({ success: false, message: 'Server error while assigning ticket.' });
    }
};

// get ticket details
export const getTicketDetails = async (req, res) => {
    try {
        // 1. Tenant Isolation (Security First)
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Missing Company ID' });
        }

        const { id } = req.params;

        // 2. Validate MongoDB ID format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid Ticket ID format.' });
        }

        // 3. Start building the query with the base populates
        let query = ServiceTicket.findOne({
            _id: id,
            companyId: req.user.companyId
        })
            .populate('createdBy', 'username fullName role email')
            .populate('assignment.technicianId', 'username fullName mobile')
            .populate('visitHistory.technicianId', 'username fullName mobile')
            .populate('visitHistory.partsUsed.item', 'name code salePrice gst hsn');

        // 4. Role-Based Payload Optimization
        //put the actual role when roles are fanalized
        if (req.user.role === 'Employee' || req.user.role === 'Technician') {
            // Technicians do not need the audit log. Strip it from the DB fetch to save bandwidth.
            query = query.select('-auditLog');
        } else {
            // Dispatchers and Admins get the deep populated audit log
            query = query.populate('auditLog.performedBy.userId', 'username fullName role');
        }

        // Execute the query
        const ticket = await query;

        // 5. Handle edge case where ticket doesn't exist
        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found.' });
        }

        // 6. Strict Security: Ensure a technician can only view their OWN assigned tickets
        if (req.user.role === 'Technician') {
            const assignedTechId = ticket.assignment?.technicianId?._id?.toString();
            const loggedInUserId = req.user._id.toString();

            if (assignedTechId !== loggedInUserId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. You are not assigned to this ticket.'
                });
            }
        }

        // 7. Send the tailored payload
        res.status(200).json({
            success: true,
            data: ticket
        });

    } catch (error) {
        console.error('Error fetching ticket details:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching ticket details.' });
    }
};

// cancel ticket
export const cancelTicket = async (req, res) => {
    try {
        // 1. Tenant Isolation
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Missing Company ID' });
        }

        const { id } = req.params;
        const { reason } = req.body; // The frontend can optionally send a reason string

        // 2. Validate MongoDB ID format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid Ticket ID format.' });
        }

        // 3. Find the Ticket securely
        const ticket = await ServiceTicket.findOne({
            _id: id,
            companyId: req.user.companyId
        });

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found.' });
        }

        // 4. Prevent cancelling a ticket that is already closed
        if (['Resolved', 'Cancelled', 'Closed'].includes(ticket.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot cancel a ticket that is already ${ticket.status}.`
            });
        }

        const previousStatus = ticket.status;

        // 5. Update Status and Stop SLA Timers
        ticket.status = 'Cancelled';
        ticket.sla.resolutionDeadline = null; // Crucial: prevents the cron job from flagging it

        // 6. Update Audit Trail
        // If the dispatcher provided a reason, we append it to the log
        const actionText = reason ? `Ticket Cancelled: ${reason}` : 'Ticket Cancelled';

        ticket.auditLog.push({
            action: actionText,
            performedBy: {
                userId: req.user._id,
                role: req.user.role
            },
            previousStatus: previousStatus,
            newStatus: 'Cancelled'
        });

        // 7. Save to Database
        await ticket.save();

        // 8. Populate basic fields for the frontend response
        await ticket.populate([
            { path: 'createdBy', select: 'username fullName role email' },
            { path: 'assignment.technicianId', select: 'username fullName mobile' }
        ]);

        // 9. Optimize payload (strip heavy arrays before sending over the network)
        const responseData = ticket.toObject();
        delete responseData.auditLog;
        delete responseData.visitHistory;

        // 10. Send Success Response
        res.status(200).json({
            success: true,
            message: 'Ticket successfully cancelled.',
            data: responseData
        });

    } catch (error) {
        console.error('Error cancelling ticket:', error);
        res.status(500).json({ success: false, message: 'Server error while cancelling ticket.' });
    }
};

export const sendVerificationEmail = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { id } = req.params;
        const ticket = await ServiceTicket.findOne({ _id: id, companyId: req.user.companyId });

        if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

        if (ticket.status !== 'Resolved' && ticket.status !== 'Pending Approval') {
            return res.status(400).json({ success: false, message: 'Ticket must be Resolved first.' });
        }

        if (!ticket.customer.email) {
            return res.status(400).json({ success: false, message: 'Customer does not have an email address.' });
        }

        // Generate a secure 32-character token
        const token = crypto.randomBytes(16).toString('hex');
        const tokenExpires = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

        const previousStatus = ticket.status;
        ticket.status = 'Pending Approval';

        if (!ticket.closure) ticket.closure = {};
        ticket.closure.customerToken = token;
        ticket.closure.tokenExpiresAt = tokenExpires;
        ticket.closure.verificationEmailSent = true;

        ticket.auditLog.push({
            action: `Verification link generated and sent to ${ticket.customer.email}`,
            performedBy: { userId: req.user._id, role: req.user.role },
            previousStatus: previousStatus,
            newStatus: 'Pending Approval'
        });

        await ticket.save();

        // --- CALL YOUR MOCK EMAIL FUNCTION ---
        const verificationLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verify-ticket/${token}`;

        await sendCommonEmail({
            type: "TICKET_VERIFICATION",
            to: ticket.customer.email,
            name: ticket.customer.name,
            data: { ticketId: ticket.tokenId, link: verificationLink }
        });
        // -------------------------------------

        res.status(200).json({
            success: true,
            message: 'Verification link sent successfully to the customer.',
            data: ticket
        });

    } catch (error) {
        console.error('Error sending verification:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// =========================================================================
// CUSTOMER ACTION: Public Endpoint to Verify Response (from their email link)
// =========================================================================
export const verifyCustomerResponse = async (req, res) => {
    try {
        const { token } = req.params;
        const { action, comments } = req.body; // action must be 'approve' (Satisfied) or 'reject' (Unsatisfied)

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid action. Must be approve or reject.' });
        }

        // Find ticket by token (this is a public endpoint, no req.user!)
        const ticket = await ServiceTicket.findOne({ 'closure.customerToken': token });

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Invalid or expired verification link.' });
        }

        // Check if token expired
        if (new Date() > ticket.closure.tokenExpiresAt) {
            return res.status(400).json({ success: false, message: 'This verification link has expired.' });
        }

        const previousStatus = ticket.status;

        // --- SCENARIO 1: Customer clicks "Satisfied" ---
        if (action === 'approve') {
            ticket.status = 'Closed';
            ticket.closure.isSatisfied = true;
            ticket.closure.feedbackComments = comments || 'Customer was satisfied with the service.';
            ticket.closure.closedAt = new Date();

            ticket.auditLog.push({
                action: `Customer verified resolution. Status: Satisfied.`,
                performedBy: { role: 'Customer' }, // No userId, because it's a public link
                previousStatus: previousStatus,
                newStatus: 'Closed'
            });

        }
        // --- SCENARIO 2: Customer clicks "Unsatisfied" ---
        else if (action === 'reject') {
            ticket.status = 'Reopened';
            ticket.closure.isSatisfied = false;
            ticket.closure.resolutionTimeMinutes = null; // Restart SLA clock

            ticket.auditLog.push({
                action: `Customer Rejected Resolution. Reason: ${comments || 'No reason provided'}`,
                performedBy: { role: 'Customer' },
                previousStatus: previousStatus,
                newStatus: 'Reopened'
            });

            // Mark the last visit as Customer Rejected
            const lastVisit = ticket.visitHistory[ticket.visitHistory.length - 1];
            if (lastVisit) {
                lastVisit.visitStatus = 'Customer Rejected';
            }
        }

        // Invalidate token so the link cannot be used twice
        ticket.closure.customerToken = null;
        ticket.closure.tokenExpiresAt = null;

        await ticket.save();

        res.status(200).json({
            success: true,
            message: action === 'approve'
                ? 'Ticket sealed successfully. Thank you for your feedback!'
                : 'Ticket reopened. We will contact you shortly.'
        });

    } catch (error) {
        console.error('Error verifying customer response:', error);
        res.status(500).json({ success: false, message: 'Server error while verifying customer response.' });
    }
};

// service invoice

import { generateServiceInvoicePDF } from '../utils/servicePdfGenerator.js';

// =========================================================================
// GENERATE SERVICE INVOICE PDF (Strictly Parts-Based)
// =========================================================================
export const generateServiceInvoice = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Fetch Ticket & deeply populate Company and Item details
        const ticket = await ServiceTicket.findOne({
            _id: id,
            companyId: req.user.companyId
        })
        .populate('companyId')
        .populate({
            path: 'visitHistory.partsUsed.item',
            select: 'name hsn salePrice gst unit mrp code' // Pulling all pricing & tax data from Item schema
        });

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }

        // 2. Aggregate Parts from ALL valid visits
        const partsMap = {};

        ticket.visitHistory.forEach(visit => {
            // 🔥 FIX: Include 'Customer Rejected' visits because parts were still consumed!
            if (['Completed', 'Customer Rejected'].includes(visit.visitStatus) && visit.partsUsed && visit.partsUsed.length > 0) {
                visit.partsUsed.forEach(part => {
                    if (part.item) {
                        const itemId = part.item._id.toString();
                        
                        // If we used this same part in a previous visit, just increase the quantity
                        if (partsMap[itemId]) {
                            partsMap[itemId].quantity += part.quantity;
                        } else {
                            // Add it as a new line item, using the exact Item schema pricing
                            partsMap[itemId] = {
                                name: `${part.item.name} (${part.item.code || ''})`,
                                hsn: part.item.hsn || '', 
                                quantity: part.quantity,
                                unit: part.item.unit || 'nos',
                                rate: part.item.salePrice || 0, // Using standard salePrice
                                mrp: part.item.mrp || part.item.salePrice || 0,
                                gst: part.item.gst || 0, // Pass GST in case the PDF utility needs it
                                discountPct: 0 // Default to 0 discount for service items
                            };
                        }
                    }
                });
            }
        });

        // Convert the map back into a flat array for the PDF generator
        const allParts = Object.values(partsMap);

        // 3. Format data exactly as your generateServiceInvoicePDF expects
        const invoiceData = {
            company: ticket.companyId,
            customer: {
                name: ticket.customer.name,
                address: ticket.customer.address,
                contact: ticket.customer.mobileNumber,
                email: ticket.customer.email || 'N/A'
            },
            // Trigger the "Machine Details" box on the right side
            machineDetails: {
                machineType: ticket.machine.machineType,
                model: ticket.machine.model || 'N/A',
                serialNumber: ticket.machine.serialNumber || 'N/A',
                warrantyStatus: ticket.machine.warrantyStatus || 'Unknown',
                amcStatus: ticket.machine.amcStatus || 'Unknown',
                issue: ticket.issue.issueType
            },
            invoiceNo: `SRV-${ticket.tokenId.split('-')[1] || Date.now()}`,
            date: new Date(ticket.updatedAt || new Date()).toLocaleDateString('en-GB'),
            ref: ticket.tokenId,
            notes: "This is a computer-generated service invoice. E. & O. E.",
            items: allParts // Only the actual parts used are billed!
        };

        // 4. Pass it to your existing PDF utility
        await generateServiceInvoicePDF(res, invoiceData);

    } catch (error) {
        console.error('Error generating PDF:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Server error generating PDF' });
        }
    }
};


/////////////// api for technicians ///////////////

export const getMyTickets = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        // Add page and limit defaults for mobile pagination
        const { view = 'active', status, page = 1, limit = 10 } = req.query;

        const query = {
            companyId: req.user.companyId,
            'assignment.technicianId': req.user._id
        };

        if (status) {
            query.status = status;
        } else if (view === 'active') {
            query.status = { $in: ['Pending', 'In Progress', 'Reopened'] };
        } else if (view === 'history') {
            query.status = { $in: ['Resolved', 'Cancelled', 'Closed'] };
        }

        // Pagination Math
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const parsedLimit = parseInt(limit);

        // SMART SORTING LOGIC
        // Active tickets -> Sort by when they are scheduled to visit (morning to afternoon)
        // History tickets -> Sort by most recently completed first (updatedAt)
        const sortLogic = view === 'history'
            ? { updatedAt: -1 }
            : { 'assignment.visitScheduledAt': 1 };

        const tickets = await ServiceTicket.find(query)
            .select('-auditLog -visitHistory')
            .sort(sortLogic)
            .skip(skip)
            .limit(parsedLimit)
            .populate('createdBy', 'fullName mobile');

        // Get total count so the mobile app knows when to stop showing the "loading..." spinner at the bottom
        const totalTickets = await ServiceTicket.countDocuments(query);

        res.status(200).json({
            success: true,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalTickets / parsedLimit),
                totalTickets,
                hasMore: (skip + tickets.length) < totalTickets // Super helpful boolean for mobile devs!
            },
            data: tickets
        });

    } catch (error) {
        console.error('Error fetching mobile tickets:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching tickets.' });
    }
};

// visit start
export const startVisit = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { id } = req.params;

        // Find ticket and ENSURE this technician actually owns it
        const ticket = await ServiceTicket.findOne({
            _id: id,
            companyId: req.user.companyId,
            'assignment.technicianId': req.user._id
        });

        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found or you are not assigned to this ticket.'
            });
        }

        if (ticket.status !== 'Pending' && ticket.status !== 'Reopened') {
            return res.status(400).json({
                success: false,
                message: `Cannot start a visit for a ticket that is ${ticket.status}.`
            });
        }

        // 1. Create the new Visit Object
        const newVisit = {
            technicianId: req.user._id,
            technicianName: req.user.fullName || req.user.username,
            visitStart: new Date(),
            visitStatus: 'Incomplete' // Defaults to incomplete until they finish
        };

        // 2. Push it into the history array
        ticket.visitHistory.push(newVisit);

        // 3. Update the ticket status
        const previousStatus = ticket.status;
        ticket.status = 'In Progress';

        // 4. Log the action
        ticket.auditLog.push({
            action: `Technician ${newVisit.technicianName} arrived on site and started work.`,
            performedBy: {
                userId: req.user._id,
                role: req.user.role
            },
            previousStatus: previousStatus,
            newStatus: 'In Progress'
        });

        await ticket.save();

        res.status(200).json({
            success: true,
            message: 'Visit started successfully.',
            data: ticket.visitHistory[ticket.visitHistory.length - 1] // Return just the new visit object
        });

    } catch (error) {
        console.error('Error starting visit:', error);
        res.status(500).json({ success: false, message: 'Server error while starting visit.' });
    }
};

// visit complete

export const completeVisit = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { id } = req.params;
        let { workDoneDetails, partsUsed } = req.body;

        // 1. Parse partsUsed if it comes as a stringified JSON from FormData
        if (typeof partsUsed === 'string') {
            try {
                // Frontend should send: '[{"item": "60d5e...", "quantity": 2}]'
                partsUsed = JSON.parse(partsUsed);
            } catch (e) {
                console.error("Failed to parse partsUsed JSON:", e);
                partsUsed = [];
            }
        }

        // Format and validate the parts array
        const formattedParts = Array.isArray(partsUsed) ? partsUsed.map(part => ({
            item: part.item || part._id, // Support different frontend payload structures
            quantity: Number(part.quantity) || 1
        })).filter(part => part.item) : []; // Filter out any invalid items

        if (!workDoneDetails) {
            return res.status(400).json({ success: false, message: 'Work done details are required.' });
        }

        // 2. Find ticket securely
        const ticket = await ServiceTicket.findOne({
            _id: id,
            companyId: req.user.companyId,
            'assignment.technicianId': req.user._id
        });

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found.' });
        }

        if (ticket.status !== 'In Progress') {
            return res.status(400).json({
                success: false,
                message: `Cannot complete a visit. Ticket is currently ${ticket.status}.`
            });
        }

        // 3. Find the active visit
        const currentVisit = ticket.visitHistory[ticket.visitHistory.length - 1];

        if (!currentVisit || currentVisit.visitStatus !== 'Incomplete') {
            return res.status(400).json({
                success: false,
                message: 'No active (incomplete) visit found to close.'
            });
        }

        // 4. Process Uploaded Media
        const mediaUrls = [];
        if (req.files && req.files.length > 0) {
            req.files.forEach(file => {
                mediaUrls.push({
                    url: file.path.replace(/\\/g, '/'), // Normalize path for Windows/Linux
                    type: file.mimetype.startsWith('video/') ? 'video' : 'image'
                });
            });
        }

        // 5. Update the visit object
        currentVisit.visitEnd = new Date();
        currentVisit.workDoneDetails = workDoneDetails;
        currentVisit.partsUsed = formattedParts
        currentVisit.media = mediaUrls; // Attach the processed files
        currentVisit.visitStatus = 'Completed';

        // 6. Auto-calculate Resolution Time (For the SLA Dashboard)
        if (!ticket.closure) ticket.closure = {};
        const totalMinutes = Math.round((new Date() - ticket.createdAt) / (1000 * 60));
        ticket.closure.resolutionTimeMinutes = totalMinutes;

        // 7. Update overall ticket status to Resolved (WAITING FOR FEEDBACK)
        const previousStatus = ticket.status;
        ticket.status = 'Resolved';

        // --- NEW: Deduct the used parts from the physical Inventory ---
        if (formattedParts.length > 0) {
            try {
                // We use bulkWrite to update multiple inventory items efficiently in one go
                const bulkOperations = formattedParts.map(part => ({
                    updateOne: {
                        filter: { _id: part.item },
                        update: { $inc: { qty: -Math.abs(part.quantity) } } // $inc with a negative number reduces the qty
                    }
                }));

                await Item.bulkWrite(bulkOperations);
                console.log(`Successfully deducted ${formattedParts.length} items from inventory.`);
            } catch (inventoryError) {
                console.error("Failed to deduct inventory:", inventoryError);
                // Note: We log the error but don't stop the ticket closure. 
                // You might want to handle this differently depending on strictness.
            }
        }
        // --------------------------------------------------------------

        // 8. Update Audit Log
        ticket.auditLog.push({
            action: `Technician finished work. Parts used: ${currentVisit.partsUsed.length}. Media attached: ${mediaUrls.length}.`,
            performedBy: {
                userId: req.user._id,
                role: req.user.role
            },
            previousStatus: previousStatus,
            newStatus: 'Resolved'
        });

        await ticket.save();

        res.status(200).json({
            success: true,
            message: 'Visit completed and ticket marked as Resolved. Waiting for customer feedback.',
            data: ticket
        });

    } catch (error) {
        console.error('Error completing visit:', error);
        res.status(500).json({ success: false, message: 'Server error while completing visit.' });
    }
};