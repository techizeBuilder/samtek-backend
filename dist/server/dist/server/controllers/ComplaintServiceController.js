"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateTechnicianProfile = exports.completeVisit = exports.startVisit = exports.getMyTickets = exports.generateServiceInvoice = exports.verifyCustomerResponse = exports.sendVerificationEmail = exports.cancelTicket = exports.getTicketDetails = exports.assignTicket = exports.getSupportTickets = exports.createSupportTicket = exports.getServicemen = exports.getCustomerHistory = void 0;
const ComplaintServiceModel_js_1 = __importDefault(require("../models/ComplaintServiceModel.js"));
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = __importDefault(require("mongoose"));
const User_js_1 = __importDefault(require("../models/User.js"));
const Inventory_js_1 = require("../models/Inventory.js");
const serviceEmail_js_1 = require("../utils/serviceEmail.js");
const servicePdfGenerator_js_1 = require("../utils/servicePdfGenerator.js");
const Customer_js_1 = __importDefault(require("../models/Customer.js")); // Adjust path if necessary
const Order_js_1 = __importDefault(require("../models/Order.js")); // Adjust path if necessary
// --- CONTROLLERS ---
// 1. Get Customer History (Dynamic & Genuine)
const getCustomerHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { mobileNumber } = req.params;
        // 1. Find the real Customer
        const customer = yield Customer_js_1.default.findOne({
            mobile: mobileNumber,
            companyId: req.user.companyId
        });
        // 2. Fetch Previous Complaints (Tickets)
        const previousTickets = yield ComplaintServiceModel_js_1.default.find({
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
            const orders = yield Order_js_1.default.find({
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
                                }
                                else {
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
    }
    catch (error) {
        console.error("Error fetching customer history:", error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});
exports.getCustomerHistory = getCustomerHistory;
// 2. Get Servicemen list (Real Database Fetch)
const getServicemen = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const users = yield User_js_1.default.find(filter);
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
            technicians = technicians.filter((tech) => tech.currentStatus === status);
        }
        // 5. Send Response
        res.status(200).json({
            success: true,
            count: technicians.length,
            data: technicians
        });
    }
    catch (error) {
        console.error('Error fetching servicemen:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching technicians.' });
    }
});
exports.getServicemen = getServicemen;
// 3. Create Support Ticket
const createSupportTicket = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized: Missing Company ID in token'
            });
        }
        const { source, customer, machine, issue, priorityLevel } = req.body;
        if (!(customer === null || customer === void 0 ? void 0 : customer.name) || !(customer === null || customer === void 0 ? void 0 : customer.mobileNumber) || !(customer === null || customer === void 0 ? void 0 : customer.address)) {
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
        if (!(machine === null || machine === void 0 ? void 0 : machine.machineType)) {
            return res.status(400).json({ success: false, message: 'Missing machine type.' });
        }
        if (!machine.serialNumber || !machine.model || !machine.warrantyStatus || !machine.amcStatus) {
            return res.status(400).json({ success: false, message: 'Missing required machine details.' });
        }
        if (!(issue === null || issue === void 0 ? void 0 : issue.issueType)) {
            return res.status(400).json({ success: false, message: 'Missing issue type.' });
        }
        const timePart = Date.now().toString(36).toUpperCase();
        const randomPart = crypto_1.default.randomBytes(2).toString('hex').toUpperCase();
        const generatedToken = `TKT-${timePart}-${randomPart}`;
        const now = new Date();
        let resolutionDeadline;
        if (priorityLevel === 'High') {
            resolutionDeadline = new Date(now.getTime() + (24 * 60 * 60 * 1000));
        }
        else if (priorityLevel === 'Medium') {
            resolutionDeadline = new Date(now.getTime() + (48 * 60 * 60 * 1000));
        }
        else {
            resolutionDeadline = new Date(now.getTime() + (72 * 60 * 60 * 1000));
        }
        const newTicket = yield ComplaintServiceModel_js_1.default.create({
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
        yield newTicket.populate([
            { path: 'createdBy', select: 'username fullName role email' },
            { path: 'auditLog.performedBy.userId', select: 'username fullName' }
        ]);
        // --- SEND EMAIL ALERTS ---
        (0, serviceEmail_js_1.sendSupportEmail)({
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
    }
    catch (error) {
        console.error('Error creating support ticket:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while creating ticket.'
        });
    }
});
exports.createSupportTicket = createSupportTicket;
// 4. Get Support Tickets (Dashboard List)
const getSupportTickets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Missing Company ID' });
        }
        const query = { companyId: req.user.companyId };
        const { page = 1, limit = 10, status, priority, isBreached, search, startDate, endDate, technicianId, issueType } = req.query;
        if (status)
            query.status = status;
        if (priority)
            query['priority.level'] = priority;
        if (isBreached !== undefined) {
            query['sla.isBreached'] = isBreached === 'true';
        }
        if (issueType)
            query['issue.issueType'] = issueType;
        if (technicianId) {
            if (technicianId === 'unassigned') {
                query['assignment.technicianId'] = null;
            }
            else {
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
        const tickets = yield ComplaintServiceModel_js_1.default.find(query)
            .select('-auditLog -visitHistory')
            .sort({ 'sla.isBreached': -1, createdAt: -1 })
            .skip(skip)
            .limit(parsedLimit)
            .populate('createdBy', 'username fullName role email')
            .populate('assignment.technicianId', 'username fullName mobile serviceZone technicianSkills');
        const totalTickets = yield ComplaintServiceModel_js_1.default.countDocuments(query);
        const metricQuery = Object.assign(Object.assign({}, query), { status: 'Resolved' });
        const resolutionStats = yield ComplaintServiceModel_js_1.default.aggregate([
            { $match: metricQuery },
            { $group: { _id: null, averageMinutes: { $avg: "$closure.resolutionTimeMinutes" } } }
        ]);
        const avgResolutionMinutes = resolutionStats.length > 0
            ? Math.round(resolutionStats[0].averageMinutes)
            : 0;
        const issueTypeStats = yield ComplaintServiceModel_js_1.default.aggregate([
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
    }
    catch (error) {
        console.error('Error fetching support tickets:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching tickets.' });
    }
});
exports.getSupportTickets = getSupportTickets;
// 5. Assign Ticket
const assignTicket = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Missing Company ID' });
        }
        const { id } = req.params;
        const { technicianId, visitScheduledAt } = req.body;
        if (!technicianId) {
            return res.status(400).json({ success: false, message: 'Technician ID is required.' });
        }
        if (!mongoose_1.default.Types.ObjectId.isValid(id) || !mongoose_1.default.Types.ObjectId.isValid(technicianId)) {
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
        const technician = yield User_js_1.default.findOne({
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
        const ticket = yield ComplaintServiceModel_js_1.default.findOne({
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
        const isReassignment = !!((_a = ticket.assignment) === null || _a === void 0 ? void 0 : _a.technicianId);
        // 🔥 NEW: If reassigned to a DIFFERENT technician, free up the PREVIOUS technician
        if (isReassignment && ticket.assignment.technicianId.toString() !== technicianId.toString()) {
            yield User_js_1.default.findByIdAndUpdate(ticket.assignment.technicianId, { currentStatus: 'Available' });
        }
        if (!ticket.assignment)
            ticket.assignment = {};
        ticket.assignment.technicianId = technicianId;
        ticket.assignment.assignedAt = new Date();
        ticket.assignment.visitScheduledAt = visitScheduledAt ? new Date(visitScheduledAt) : null;
        if (ticket.status === 'Unassigned') {
            ticket.status = 'Pending';
        }
        // 🔥 NEW: Mark the NEW technician as 'On Job'
        technician.currentStatus = 'On Job';
        yield technician.save();
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
        yield ticket.save();
        yield ticket.populate([
            { path: 'createdBy', select: 'username fullName role email' },
            { path: 'assignment.technicianId', select: 'username fullName mobile serviceZone technicianSkills' }
        ]);
        const responseData = ticket.toObject();
        delete responseData.auditLog;
        delete responseData.visitHistory;
        // --- SEND EMAIL ALERTS ---
        (0, serviceEmail_js_1.sendSupportEmail)({
            type: 'ASSIGNED_CUSTOMER',
            to: ticket.customer.email,
            name: ticket.customer.name,
            data: {
                ticketId: ticket.tokenId,
                techName: techName,
                techContact: technician.mobile || 'N/A'
            }
        });
        (0, serviceEmail_js_1.sendSupportEmail)({
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
    }
    catch (error) {
        console.error('Error assigning ticket:', error);
        res.status(500).json({ success: false, message: 'Server error while assigning ticket.' });
    }
});
exports.assignTicket = assignTicket;
// 6. Get ticket details
const getTicketDetails = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Missing Company ID' });
        }
        const { id } = req.params;
        if (!mongoose_1.default.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid Ticket ID format.' });
        }
        let query = ComplaintServiceModel_js_1.default.findOne({
            _id: id,
            companyId: req.user.companyId
        })
            .populate('createdBy', 'username fullName role email')
            .populate('assignment.technicianId', 'username fullName mobile serviceZone technicianSkills')
            .populate('visitHistory.technicianId', 'username fullName mobile')
            .populate('visitHistory.partsUsed.item', 'name code salePrice gst hsn');
        if (req.user.role === 'Complaint Management Employee') {
            query = query.select('-auditLog');
        }
        else {
            query = query.populate('auditLog.performedBy.userId', 'username fullName role');
        }
        const ticket = yield query;
        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found.' });
        }
        if (req.user.role === 'Complaint Management Employee') {
            const assignedTechId = (_c = (_b = (_a = ticket.assignment) === null || _a === void 0 ? void 0 : _a.technicianId) === null || _b === void 0 ? void 0 : _b._id) === null || _c === void 0 ? void 0 : _c.toString();
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
    }
    catch (error) {
        console.error('Error fetching ticket details:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching ticket details.' });
    }
});
exports.getTicketDetails = getTicketDetails;
// 7. Cancel ticket
const cancelTicket = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Missing Company ID' });
        }
        const { id } = req.params;
        const { reason } = req.body;
        if (!mongoose_1.default.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid Ticket ID format.' });
        }
        const ticket = yield ComplaintServiceModel_js_1.default.findOne({
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
        if ((_a = ticket.assignment) === null || _a === void 0 ? void 0 : _a.technicianId) {
            yield User_js_1.default.findByIdAndUpdate(ticket.assignment.technicianId, { currentStatus: 'Available' });
        }
        yield ticket.save();
        yield ticket.populate([
            { path: 'createdBy', select: 'username fullName role email' },
            { path: 'assignment.technicianId', select: 'username fullName mobile' }
        ]);
        const responseData = ticket.toObject();
        delete responseData.auditLog;
        delete responseData.visitHistory;
        // --- SEND EMAIL ALERTS ---
        (0, serviceEmail_js_1.sendSupportEmail)({
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
    }
    catch (error) {
        console.error('Error cancelling ticket:', error);
        res.status(500).json({ success: false, message: 'Server error while cancelling ticket.' });
    }
});
exports.cancelTicket = cancelTicket;
// 8. Send Verification Email
const sendVerificationEmail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        const { id } = req.params;
        const ticket = yield ComplaintServiceModel_js_1.default.findOne({ _id: id, companyId: req.user.companyId });
        if (!ticket)
            return res.status(404).json({ success: false, message: 'Ticket not found.' });
        if (ticket.status !== 'Resolved' && ticket.status !== 'Pending Approval') {
            return res.status(400).json({ success: false, message: 'Ticket must be Resolved first.' });
        }
        if (!ticket.customer.email) {
            return res.status(400).json({ success: false, message: 'Customer does not have an email address.' });
        }
        const token = crypto_1.default.randomBytes(16).toString('hex');
        const tokenExpires = new Date(Date.now() + 48 * 60 * 60 * 1000);
        const previousStatus = ticket.status;
        ticket.status = 'Pending Approval';
        if (!ticket.closure)
            ticket.closure = {};
        ticket.closure.customerToken = token;
        ticket.closure.tokenExpiresAt = tokenExpires;
        ticket.closure.verificationEmailSent = true;
        ticket.auditLog.push({
            action: `Verification link generated and sent to ${ticket.customer.email}`,
            performedBy: { userId: req.user._id, role: req.user.role },
            previousStatus: previousStatus,
            newStatus: 'Pending Approval'
        });
        yield ticket.save();
        // --- SEND REAL HTML VERIFICATION EMAIL ---
        const verificationLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verify-ticket/${token}`;
        yield (0, serviceEmail_js_1.sendSupportEmail)({
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
    }
    catch (error) {
        console.error('Error sending verification:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});
exports.sendVerificationEmail = sendVerificationEmail;
// 9. Verify Customer Response (Public)
const verifyCustomerResponse = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { token } = req.params;
        const { action, comments } = req.body;
        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid action. Must be approve or reject.' });
        }
        const ticket = yield ComplaintServiceModel_js_1.default.findOne({ 'closure.customerToken': token });
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
            (0, serviceEmail_js_1.sendSupportEmail)({
                type: 'CLOSED',
                to: ticket.customer.email,
                name: ticket.customer.name,
                data: { ticketId: ticket.tokenId }
            });
        }
        else if (action === 'reject') {
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
        yield ticket.save();
        res.status(200).json({
            success: true,
            message: action === 'approve'
                ? 'Ticket sealed successfully. Thank you for your feedback!'
                : 'Ticket reopened. We will contact you shortly.'
        });
    }
    catch (error) {
        console.error('Error verifying customer response:', error);
        res.status(500).json({ success: false, message: 'Server error while verifying customer response.' });
    }
});
exports.verifyCustomerResponse = verifyCustomerResponse;
// 10. Generate Service Invoice
const generateServiceInvoice = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const ticket = yield ComplaintServiceModel_js_1.default.findOne({
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
                        }
                        else {
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
        yield (0, servicePdfGenerator_js_1.generateServiceInvoicePDF)(res, invoiceData);
    }
    catch (error) {
        console.error('Error generating PDF:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Server error generating PDF' });
        }
    }
});
exports.generateServiceInvoice = generateServiceInvoice;
// 11. Get My Tickets (Technician App)
const getMyTickets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        }
        else if (view === 'active') {
            query.status = { $in: ['Pending', 'In Progress', 'Reopened'] };
        }
        else if (view === 'history') {
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
        const tickets = yield ComplaintServiceModel_js_1.default.find(query)
            .select('-auditLog -visitHistory')
            .sort(sortLogic)
            .skip(skip)
            .limit(parsedLimit)
            .populate('createdBy', 'fullName mobile');
        const totalTickets = yield ComplaintServiceModel_js_1.default.countDocuments(query);
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
    }
    catch (error) {
        console.error('Error fetching mobile tickets:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching tickets.' });
    }
});
exports.getMyTickets = getMyTickets;
// 12. Start Visit
const startVisit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        const { id } = req.params;
        const ticket = yield ComplaintServiceModel_js_1.default.findOne({
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
        yield ticket.save();
        res.status(200).json({
            success: true,
            message: 'Visit started successfully.',
            data: ticket.visitHistory[ticket.visitHistory.length - 1]
        });
    }
    catch (error) {
        console.error('Error starting visit:', error);
        res.status(500).json({ success: false, message: 'Server error while starting visit.' });
    }
});
exports.startVisit = startVisit;
// 13. Complete Visit
const completeVisit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        const { id } = req.params;
        let { workDoneDetails, partsUsed } = req.body;
        if (typeof partsUsed === 'string') {
            try {
                partsUsed = JSON.parse(partsUsed);
            }
            catch (e) {
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
        const ticket = yield ComplaintServiceModel_js_1.default.findOne({
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
        if (!ticket.closure)
            ticket.closure = {};
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
                yield Inventory_js_1.Item.bulkWrite(bulkOperations);
                console.log(`Successfully deducted ${formattedParts.length} items from inventory.`);
            }
            catch (inventoryError) {
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
        yield User_js_1.default.findByIdAndUpdate(req.user._id, { currentStatus: 'Available' });
        yield ticket.save();
        res.status(200).json({
            success: true,
            message: 'Visit completed and ticket marked as Resolved. Waiting for customer feedback.',
            data: ticket
        });
    }
    catch (error) {
        console.error('Error completing visit:', error);
        res.status(500).json({ success: false, message: 'Server error while completing visit.' });
    }
});
exports.completeVisit = completeVisit;
// 14. Update Technician Profile (For Complaint Head)
const updateTechnicianProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        const { id } = req.params;
        const { serviceZone, technicianSkills } = req.body;
        // Find the technician
        const technician = yield User_js_1.default.findOne({
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
            }
            else if (typeof technicianSkills === 'string') {
                try {
                    finalSkills = JSON.parse(technicianSkills);
                }
                catch (e) {
                    finalSkills = technicianSkills.split(',').map(s => s.trim());
                }
            }
        }
        // Update fields
        if (serviceZone !== undefined)
            technician.serviceZone = serviceZone;
        technician.technicianSkills = finalSkills;
        yield technician.save();
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
    }
    catch (error) {
        console.error('Error updating technician:', error);
        res.status(500).json({ success: false, message: 'Server error while updating technician.' });
    }
});
exports.updateTechnicianProfile = updateTechnicianProfile;
