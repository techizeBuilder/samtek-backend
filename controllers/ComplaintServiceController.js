import ServiceTicket from '../models/ComplaintServiceModel.js';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { Item } from '../models/Inventory.js';
import { sendSupportEmail } from '../utils/serviceEmail.js';
import { generateServiceInvoicePDF } from '../utils/servicePdfGenerator.js';
import Customer from '../models/Customer.js';
import Order from '../models/Order.js';
import notificationService from '../services/notificationService.js';

// --- CONTROLLERS ---

// 1. Get Customer History (Dynamic & Genuine)
export const getCustomerHistory = async (req, res) => {
    try {
        const { mobileNumber } = req.params;

        // 1. Find the real Customer
        const customer = await Customer.findOne({
            mobile: mobileNumber,
            companyId: req.user.companyId
        });

        // 2. Fetch Previous Complaints (Tickets)
        const previousTickets = await ServiceTicket.find({
            "customer.mobileNumber": mobileNumber,
            companyId: req.user.companyId
        })
            .select('tokenId status createdAt issue.issueType')
            .sort({ createdAt: -1 })
            .limit(5);

        // 3. If neither customer nor history exists, return 404
        if (!customer && previousTickets.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No history found for this number.'
            });
        }

        let pastPurchases = [];

        // 4. If Customer exists, pull their actual machines from their Orders
        if (customer) {
            // Find all orders that aren't cancelled or rejected
            const orders = await Order.find({
                customer: customer._id,
                companyId: req.user.companyId,
                status: { $nin: ['cancelled', 'rejected'] }
            }).populate('products.product', 'name category code'); // Pull item details

            // Loop through all orders, and all products in those orders
            orders.forEach(order => {
                order.products.forEach(lineItem => {

                    // Read from the new machineDetails array!
                    if (lineItem.machineDetails && lineItem.machineDetails.length > 0) {
                        lineItem.machineDetails.forEach(machine => {
                            // 1. Calculate Warranty specifically for THIS serial number
                            let wStatus = 'Unknown';
                            if (machine.warrantyExpiryDate) {
                                wStatus = new Date(machine.warrantyExpiryDate) > new Date() ? 'Active' : 'Expired';
                            }

                            // 2. Calculate AMC specifically for THIS serial number
                            let aStatus = 'Not Subscribed';
                            if (machine.amcExpiryDate) {
                                const expiry = new Date(machine.amcExpiryDate);
                                if (expiry > new Date()) {
                                    aStatus = `Valid until ${expiry.toLocaleDateString('en-GB')}`;
                                } else {
                                    aStatus = 'Expired';
                                }
                            }

                            // 3. Push the specific machine to the frontend list
                            pastPurchases.push({
                                machineType: lineItem.product ? lineItem.product.category : "Unknown",
                                model: lineItem.product ? lineItem.product.name : "Unknown",
                                serialNumber: machine.serialNumber,
                                purchaseDate: order.orderDate ? new Date(order.orderDate).toISOString().split('T')[0] : "Unknown",
                                warrantyStatus: wStatus,
                                amcStatus: aStatus,
                                amcDocumentUrl: machine.amcDocumentUrl || null
                            });
                        });
                    }
                });
            });
        }

        // 5. Send Dynamic Response exactly how the frontend expects it
        res.status(200).json({
            success: true,
            data: {
                customerName: customer ? customer.name : "Unknown Customer",
                mobileNumber: mobileNumber,
                address: customer ? (customer.address1 || "") : "",
                email: customer ? (customer.email || "") : "",
                pastPurchases: pastPurchases,
                previousComplaints: previousTickets
            }
        });

    } catch (error) {
        console.error("Error fetching customer history:", error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// 2. Get Servicemen list (Real Database Fetch)
export const getServicemen = async (req, res) => {
    try {
        const { status, zone } = req.query; // Added 'zone' filter capability

        // 1. Security Check
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Missing Company ID' });
        }

        // Base filter
        let filter = {
            companyId: req.user.companyId,
            isActive: true,
            role: 'Complaint Management Employee'
        };

        // If the dispatcher wants to filter by a specific zone from the frontend
        if (zone) {
            filter.serviceZone = zone;
        }

        // 2. Fetch real technicians from the database
        const users = await User.find(filter);

        // 3. Map the User documents to match the exact structure the frontend expects, now 100% dynamic
        let technicians = users.map(user => ({
            _id: user._id,
            name: user.fullName || user.username,
            role: user.role,
            contact: user.mobile || 'N/A',

            // Read real skills, default to 'General Support' if HR left it blank
            skills: user.technicianSkills && user.technicianSkills.length > 0
                ? user.technicianSkills
                : ["General Support"],

            // Read real zone, fallback to their unit or 'All'
            serviceZone: user.serviceZone || user.unit || "All",

            currentStatus: user.currentStatus || "Available",
            companyId: user.companyId
        }));

        // 4. Apply status filter if requested
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

        const {
            source,
            customer,
            machine,
            issue,
            priorityLevel
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
        if (!machine.serialNumber || !machine.model || !machine.warrantyStatus || !machine.amcStatus) {
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

        // --- SEND EMAIL ALERTS ---
        sendSupportEmail({
            companyId: req.user.companyId,
            type: 'CREATED',
            to: newTicket.customer.email,
            name: newTicket.customer.name,
            data: {
                ticketId: newTicket.tokenId,
                machineType: newTicket.machine.machineType,
                issueType: newTicket.issue.issueType
            }
        });

        res.status(201).json({
            success: true,
            message: 'Ticket created successfully',
            data: newTicket
        });

        // 🔔 Notify Complaint Head about new ticket
        try {
          await notificationService.triggerComplaintNotification({
            action: 'ticket_created',
            data: { ticketId: newTicket.tokenId, customerName: newTicket.customer.name, priorityLevel: priorityLevel },
            targetCompanyId: req.user.companyId,
          });
        } catch (e) { console.error('Ticket created notification error:', e); }

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
            .select('-auditLog -visitHistory')
            .sort({ 'sla.isBreached': -1, createdAt: -1 })
            .skip(skip)
            .limit(parsedLimit)
            .populate('createdBy', 'username fullName role email')
            .populate('assignment.technicianId', 'username fullName mobile serviceZone technicianSkills');

        const totalTickets = await ServiceTicket.countDocuments(query);

        const metricQuery = { ...query, status: 'Resolved' };
        const resolutionStats = await ServiceTicket.aggregate([
            { $match: metricQuery },
            { $group: { _id: null, averageMinutes: { $avg: "$closure.resolutionTimeMinutes" } } }
        ]);

        const avgResolutionMinutes = resolutionStats.length > 0
            ? Math.round(resolutionStats[0].averageMinutes)
            : 0;

        const issueTypeStats = await ServiceTicket.aggregate([
            { $match: query },
            { $group: { _id: "$issue.issueType", count: { $sum: 1 } } }
        ]);

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
            role: 'Complaint Management Employee'
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

        // 🔥 NEW: If reassigned to a DIFFERENT technician, free up the PREVIOUS technician
        if (isReassignment && ticket.assignment.technicianId.toString() !== technicianId.toString()) {
            await User.findByIdAndUpdate(ticket.assignment.technicianId, { currentStatus: 'Available' });
        }

        if (!ticket.assignment) ticket.assignment = {};
        ticket.assignment.technicianId = technicianId;
        ticket.assignment.assignedAt = new Date();
        ticket.assignment.visitScheduledAt = visitScheduledAt ? new Date(visitScheduledAt) : null;

        if (ticket.status === 'Unassigned') {
            ticket.status = 'Pending';
        }

        // 🔥 NEW: Mark the NEW technician as 'On Job'
        technician.currentStatus = 'On Job';
        await technician.save();

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

        await ticket.save();

        await ticket.populate([
            { path: 'createdBy', select: 'username fullName role email' },
            { path: 'assignment.technicianId', select: 'username fullName mobile serviceZone technicianSkills' }
        ]);

        const responseData = ticket.toObject();
        delete responseData.auditLog;
        delete responseData.visitHistory;

        // --- SEND EMAIL ALERTS ---
        sendSupportEmail({
            companyId: req.user.companyId,
            type: 'ASSIGNED_CUSTOMER',
            to: ticket.customer.email,
            name: ticket.customer.name,
            data: {
                ticketId: ticket.tokenId,
                techName: techName,
                techContact: technician.mobile || 'N/A'
            }
        });

        sendSupportEmail({
            companyId: req.user.companyId,
            type: 'ASSIGNED_TECH',
            to: technician.email || technician.username,
            name: techName,
            data: {
                ticketId: ticket.tokenId,
                customerName: ticket.customer.name,
                address: ticket.customer.address,
                deadline: ticket.sla.resolutionDeadline
            }
        });

        res.status(200).json({
            success: true,
            message: actionText,
            data: responseData
        });

        // 🔔 Notify technician and complaint head about assignment
        try {
          await notificationService.triggerComplaintNotification({
            action: 'ticket_assigned',
            data: {
              ticketId: ticket.tokenId,
              customerName: ticket.customer.name,
              technicianName: techName,
              technicianUserId: technicianId,
              visitDate: ticket.assignment.visitScheduledAt
            },
            targetCompanyId: req.user.companyId,
          });
        } catch (e) { console.error('Ticket assigned notification error:', e); }

    } catch (error) {
        console.error('Error assigning ticket:', error);
        res.status(500).json({ success: false, message: 'Server error while assigning ticket.' });
    }
};

// 6. Get ticket details
export const getTicketDetails = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Missing Company ID' });
        }

        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid Ticket ID format.' });
        }

        let query = ServiceTicket.findOne({
            _id: id,
            companyId: req.user.companyId
        })
            .populate('createdBy', 'username fullName role email')
            .populate('assignment.technicianId', 'username fullName mobile serviceZone technicianSkills')
            .populate('visitHistory.technicianId', 'username fullName mobile')
            .populate('visitHistory.partsUsed.item', 'name code salePrice gst hsn');

        if (req.user.role === 'Complaint Management Employee') {
            query = query.select('-auditLog');
        } else {
            query = query.populate('auditLog.performedBy.userId', 'username fullName role');
        }

        const ticket = await query;

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found.' });
        }

        if (req.user.role === 'Complaint Management Employee') {
            const assignedTechId = ticket.assignment?.technicianId?._id?.toString();
            const loggedInUserId = req.user._id.toString();

            if (assignedTechId !== loggedInUserId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. You are not assigned to this ticket.'
                });
            }
        }

        res.status(200).json({
            success: true,
            data: ticket
        });

    } catch (error) {
        console.error('Error fetching ticket details:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching ticket details.' });
    }
};

// 7. Cancel ticket
export const cancelTicket = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Missing Company ID' });
        }

        const { id } = req.params;
        const { reason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid Ticket ID format.' });
        }

        const ticket = await ServiceTicket.findOne({
            _id: id,
            companyId: req.user.companyId
        });

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found.' });
        }

        if (['Resolved', 'Cancelled', 'Closed'].includes(ticket.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot cancel a ticket that is already ${ticket.status}.`
            });
        }

        const previousStatus = ticket.status;

        ticket.status = 'Cancelled';
        ticket.sla.resolutionDeadline = null;

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

        // 🔥 NEW: Free up the technician if one was currently assigned to this cancelled ticket
        if (ticket.assignment?.technicianId) {
            await User.findByIdAndUpdate(ticket.assignment.technicianId, { currentStatus: 'Available' });
        }

        await ticket.save();

        await ticket.populate([
            { path: 'createdBy', select: 'username fullName role email' },
            { path: 'assignment.technicianId', select: 'username fullName mobile' }
        ]);

        const responseData = ticket.toObject();
        delete responseData.auditLog;
        delete responseData.visitHistory;

        // --- SEND EMAIL ALERTS ---
        sendSupportEmail({
            companyId: req.user.companyId,
            type: 'CANCELLED',
            to: ticket.customer.email,
            name: ticket.customer.name,
            data: {
                ticketId: ticket.tokenId,
                reason: reason || 'Administrative Cancellation'
            }
        });

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

// 8. Send Verification Email
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

        const token = crypto.randomBytes(16).toString('hex');
        const tokenExpires = new Date(Date.now() + 48 * 60 * 60 * 1000);

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

        // --- SEND REAL HTML VERIFICATION EMAIL ---
        const verificationLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verify-ticket/${token}`;

        await sendSupportEmail({
            companyId: req.user.companyId,
            type: 'VERIFICATION',
            to: ticket.customer.email,
            name: ticket.customer.name,
            data: {
                ticketId: ticket.tokenId,
                link: verificationLink
            }
        });
        // -----------------------------------------

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

// 9. Verify Customer Response (Public)
export const verifyCustomerResponse = async (req, res) => {
    try {
        const { token } = req.params;
        const { action, comments } = req.body;

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid action. Must be approve or reject.' });
        }

        const ticket = await ServiceTicket.findOne({ 'closure.customerToken': token });

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Invalid or expired verification link.' });
        }

        if (new Date() > ticket.closure.tokenExpiresAt) {
            return res.status(400).json({ success: false, message: 'This verification link has expired.' });
        }

        const previousStatus = ticket.status;

        if (action === 'approve') {
            ticket.status = 'Closed';
            ticket.closure.isSatisfied = true;
            ticket.closure.feedbackComments = comments || 'Customer was satisfied with the service.';
            ticket.closure.closedAt = new Date();

            ticket.auditLog.push({
                action: `Customer verified resolution. Status: Satisfied.`,
                performedBy: { role: 'Customer' },
                previousStatus: previousStatus,
                newStatus: 'Closed'
            });

            // --- SEND EMAIL ALERT ---
            sendSupportEmail({
                companyId: ticket.companyId,
                type: 'CLOSED',
                to: ticket.customer.email,
                name: ticket.customer.name,
                data: { ticketId: ticket.tokenId }
            });

        } else if (action === 'reject') {
            ticket.status = 'Reopened';
            ticket.closure.isSatisfied = false;
            ticket.closure.resolutionTimeMinutes = null;

            ticket.auditLog.push({
                action: `Customer Rejected Resolution. Reason: ${comments || 'No reason provided'}`,
                performedBy: { role: 'Customer' },
                previousStatus: previousStatus,
                newStatus: 'Reopened'
            });

            const lastVisit = ticket.visitHistory[ticket.visitHistory.length - 1];
            if (lastVisit) {
                lastVisit.visitStatus = 'Customer Rejected';
            }
        }

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

// 10. Generate Service Invoice
export const generateServiceInvoice = async (req, res) => {
    try {
        const { id } = req.params;

        const ticket = await ServiceTicket.findOne({
            _id: id,
            companyId: req.user.companyId
        })
            .populate('companyId')
            .populate({
                path: 'visitHistory.partsUsed.item',
                select: 'name hsn salePrice gst unit mrp code'
            });

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }

        const partsMap = {};

        ticket.visitHistory.forEach(visit => {
            if (['Completed', 'Customer Rejected'].includes(visit.visitStatus) && visit.partsUsed && visit.partsUsed.length > 0) {
                visit.partsUsed.forEach(part => {
                    if (part.item) {
                        const itemId = part.item._id.toString();

                        if (partsMap[itemId]) {
                            partsMap[itemId].quantity += part.quantity;
                        } else {
                            partsMap[itemId] = {
                                name: `${part.item.name} (${part.item.code || ''})`,
                                hsn: part.item.hsn || '',
                                quantity: part.quantity,
                                unit: part.item.unit || 'nos',
                                rate: part.item.salePrice || 0,
                                mrp: part.item.mrp || part.item.salePrice || 0,
                                gst: part.item.gst || 0,
                                discountPct: 0
                            };
                        }
                    }
                });
            }
        });

        const allParts = Object.values(partsMap);

        const invoiceData = {
            company: ticket.companyId,
            customer: {
                name: ticket.customer.name,
                address: ticket.customer.address,
                contact: ticket.customer.mobileNumber,
                email: ticket.customer.email || 'N/A'
            },
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
            items: allParts
        };

        await generateServiceInvoicePDF(res, invoiceData);

    } catch (error) {
        console.error('Error generating PDF:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Server error generating PDF' });
        }
    }
};

// 11. Get My Tickets (Technician App)
export const getMyTickets = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { view = 'active', status, page = 1, limit = 10, search, startDate, endDate } = req.query;

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
                { 'customer.name': { $regex: search, $options: 'i' } },
                { 'machine.serialNumber': { $regex: search, $options: 'i' } },
                { 'issue.issueType': { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const parsedLimit = parseInt(limit);

        const sortLogic = view === 'history'
            ? { updatedAt: -1 }
            : { 'assignment.visitScheduledAt': 1 };

        const tickets = await ServiceTicket.find(query)
            .select('-auditLog -visitHistory')
            .sort(sortLogic)
            .skip(skip)
            .limit(parsedLimit)
            .populate('createdBy', 'fullName mobile');

        const totalTickets = await ServiceTicket.countDocuments(query);

        res.status(200).json({
            success: true,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalTickets / parsedLimit),
                totalTickets,
                hasMore: (skip + tickets.length) < totalTickets
            },
            data: tickets
        });

    } catch (error) {
        console.error('Error fetching mobile tickets:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching tickets.' });
    }
};

// 12. Start Visit
export const startVisit = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { id } = req.params;

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

        const newVisit = {
            technicianId: req.user._id,
            technicianName: req.user.fullName || req.user.username,
            visitStart: new Date(),
            visitStatus: 'Incomplete'
        };

        ticket.visitHistory.push(newVisit);

        const previousStatus = ticket.status;
        ticket.status = 'In Progress';

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
            data: ticket.visitHistory[ticket.visitHistory.length - 1]
        });

    } catch (error) {
        console.error('Error starting visit:', error);
        res.status(500).json({ success: false, message: 'Server error while starting visit.' });
    }
};

// 13. Complete Visit
export const completeVisit = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { id } = req.params;
        let { workDoneDetails, partsUsed } = req.body;

        if (typeof partsUsed === 'string') {
            try {
                partsUsed = JSON.parse(partsUsed);
            } catch (e) {
                console.error("Failed to parse partsUsed JSON:", e);
                partsUsed = [];
            }
        }

        const formattedParts = Array.isArray(partsUsed) ? partsUsed.map(part => ({
            item: part.item || part._id,
            quantity: Number(part.quantity) || 1
        })).filter(part => part.item) : [];

        if (!workDoneDetails) {
            return res.status(400).json({ success: false, message: 'Work done details are required.' });
        }

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

        const currentVisit = ticket.visitHistory[ticket.visitHistory.length - 1];

        if (!currentVisit || currentVisit.visitStatus !== 'Incomplete') {
            return res.status(400).json({
                success: false,
                message: 'No active (incomplete) visit found to close.'
            });
        }

        const mediaUrls = [];
        if (req.files && req.files.length > 0) {
            req.files.forEach(file => {
                mediaUrls.push({
                    url: file.path.replace(/\\/g, '/'),
                    type: file.mimetype.startsWith('video/') ? 'video' : 'image'
                });
            });
        }

        currentVisit.visitEnd = new Date();
        currentVisit.workDoneDetails = workDoneDetails;
        currentVisit.partsUsed = formattedParts;
        currentVisit.media = mediaUrls;
        currentVisit.visitStatus = 'Completed';

        if (!ticket.closure) ticket.closure = {};
        const totalMinutes = Math.round((new Date() - ticket.createdAt) / (1000 * 60));
        ticket.closure.resolutionTimeMinutes = totalMinutes;

        const previousStatus = ticket.status;
        ticket.status = 'Resolved';

        if (formattedParts.length > 0) {
            try {
                const bulkOperations = formattedParts.map(part => ({
                    updateOne: {
                        filter: { _id: part.item },
                        update: { $inc: { qty: -Math.abs(part.quantity) } }
                    }
                }));

                await Item.bulkWrite(bulkOperations);
                console.log(`Successfully deducted ${formattedParts.length} items from inventory.`);
            } catch (inventoryError) {
                console.error("Failed to deduct inventory:", inventoryError);
            }
        }

        ticket.auditLog.push({
            action: `Technician finished work. Parts used: ${currentVisit.partsUsed.length}. Media attached: ${mediaUrls.length}.`,
            performedBy: {
                userId: req.user._id,
                role: req.user.role
            },
            previousStatus: previousStatus,
            newStatus: 'Resolved'
        });

        // 🔥 NEW: Free up the technician so they appear 'Available' to the dispatcher
        await User.findByIdAndUpdate(req.user._id, { currentStatus: 'Available' });

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

// 14. Update Technician Profile (For Complaint Head)
export const updateTechnicianProfile = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { id } = req.params;
        const { serviceZone, technicianSkills } = req.body;

        // Find the technician
        const technician = await User.findOne({
            _id: id,
            companyId: req.user.companyId,
            role: 'Complaint Management Employee'
        });

        if (!technician) {
            return res.status(404).json({ success: false, message: 'Technician not found.' });
        }

        // Parse skills securely
        let finalSkills = technician.technicianSkills;
        if (technicianSkills !== undefined) {
            if (Array.isArray(technicianSkills)) {
                finalSkills = technicianSkills;
            } else if (typeof technicianSkills === 'string') {
                try {
                    finalSkills = JSON.parse(technicianSkills);
                } catch (e) {
                    finalSkills = technicianSkills.split(',').map(s => s.trim());
                }
            }
        }

        // Update fields
        if (serviceZone !== undefined) technician.serviceZone = serviceZone;
        technician.technicianSkills = finalSkills;

        await technician.save();

        res.status(200).json({
            success: true,
            message: 'Technician profile updated successfully.',
            data: {
                _id: technician._id,
                name: technician.fullName || technician.username,
                serviceZone: technician.serviceZone,
                technicianSkills: technician.technicianSkills
            }
        });

    } catch (error) {
        console.error('Error updating technician:', error);
        res.status(500).json({ success: false, message: 'Server error while updating technician.' });
    }
};