"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function () { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function (o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function (o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o)
                if (Object.prototype.hasOwnProperty.call(o, k))
                    ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule)
            return mod;
        var result = {};
        if (mod != null)
            for (var k = ownKeys(mod), i = 0; i < k.length; i++)
                if (k[i] !== "default")
                    __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.sendLeadToAccount = exports.updatePaymentCheckStatus = exports.requestPaymentCheck = exports.markLeadAsWon = exports.getAssignableUsers = exports.checkExistingLead = exports.deleteLead = exports.updateLead = exports.getLeadById = exports.getLeads = exports.createLead = void 0;
const Lead_js_1 = __importDefault(require("../models/Lead.js"));
const User_js_1 = __importDefault(require("../models/User.js"));
const Customer_js_1 = __importDefault(require("../models/Customer.js"));
const mongoose_1 = __importDefault(require("mongoose"));
// Create new lead
const createLead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leadData = req.body;
        // Auto-generate lead code (e.g., LD-0001)
        const count = yield Lead_js_1.default.countDocuments({ companyId: req.user.companyId });
        const leadCode = `LD-${String(count + 1).padStart(4, '0')}`;
        const newLead = new Lead_js_1.default(Object.assign(Object.assign({}, leadData), { leadCode, companyId: req.user.companyId, assignedTo: leadData.assignedTo || req.user._id, history: [{
                    action: 'Lead Created',
                    notes: 'Initial lead entry',
                    performedBy: req.user._id
                }] }));
        yield newLead.save();
        res.status(201).json({ success: true, message: 'Lead created successfully', lead: newLead });
    }
    catch (error) {
        console.error('Error creating lead:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});
exports.createLead = createLead;
// Get all leads for a company with filtering
const getLeads = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { status, stage, assignedTo, search, limit = 20, sortBy = 'createdAt', order = 'desc', state, city, source, customerType, enquiryDateFrom, enquiryDateTo, nextFollowUpDateFrom, nextFollowUpDateTo, paymentCheckRequested } = req.query;
        const query = { companyId: req.user.companyId };
        const andConditions = [];
        if (paymentCheckRequested === 'true') {
            query.paymentCheckStatus = { $in: ['Pending', 'Paid', 'Partially Paid', 'Rejected'] };
        }
        // 🎯 NEW ROLE-BASED ACCESS CONTROL
        const currentUser = yield User_js_1.default.findById(req.user._id).populate('designationId');
        // Check if user is Cruncher (can see ALL leads + assign)
        const isCruncher = ((_a = currentUser === null || currentUser === void 0 ? void 0 : currentUser.designationId) === null || _a === void 0 ? void 0 : _a.name) === 'Cruncher' ||
            ((_b = currentUser === null || currentUser === void 0 ? void 0 : currentUser.designation) === null || _b === void 0 ? void 0 : _b.name) === 'Cruncher' ||
            ((currentUser === null || currentUser === void 0 ? void 0 : currentUser.role) === 'Sales Employee' && (currentUser === null || currentUser === void 0 ? void 0 : currentUser.designation) === 'Cruncher');
        // Check if user is Sales Head (can see ALL leads + assign)
        const isSalesHead = ['Sales Head', 'Manager', 'Super Admin', 'Superadmin'].includes(req.user.role);
        // Check if user is Accounts (for payment verification)
        const isAccounts = ['Accounts', 'Accounts Head', 'Account Employee', 'Finance Manager'].includes(req.user.role);
        // Check if user is regular Sales Employee (can see ONLY assigned leads)
        const isSalesEmployee = ['Sales', 'Sales Employee'].includes(req.user.role) && !isCruncher;
        console.log(`🔍 Lead Access Control - User: ${req.user.username}, Role: ${req.user.role}, Designation: ${((_c = currentUser === null || currentUser === void 0 ? void 0 : currentUser.designationId) === null || _c === void 0 ? void 0 : _c.name) || (currentUser === null || currentUser === void 0 ? void 0 : currentUser.designation)}, isCruncher: ${isCruncher}, isSalesHead: ${isSalesHead}, isSalesEmployee: ${isSalesEmployee}`);
        // 🚫 VISIBILITY RULES:
        // - Cruncher: Can see ALL leads
        // - Sales Head: Can see ALL leads  
        // - Sales Employee (Non-Cruncher): Can see ONLY assigned leads
        // - Accounts: Can see leads sent to account
        if (isSalesEmployee && !isCruncher) {
            // Sales Employee (Non-Cruncher) - Only assigned leads
            andConditions.push({
                $or: [
                    { assignedTo: req.user._id },
                    { observer: req.user._id }
                ]
            });
            console.log(`🔒 Restricted access for Sales Employee: ${req.user.username} - Only assigned leads`);
        }
        else if (isAccounts && !isSalesHead) {
            // Accounts can see leads sent to account or payment check requested
            andConditions.push({
                $or: [
                    { sentToAccount: true },
                    { paymentCheckStatus: { $in: ['Pending', 'Paid', 'Partially Paid', 'Rejected'] } }
                ]
            });
            console.log(`💰 Accounts access for: ${req.user.username} - Payment related leads only`);
        }
        // Cruncher and Sales Head get full access (no additional conditions)
        // Basic filters
        if (status && status !== 'all' && status !== 'All Active Leads') {
            if (status === "Today's Follow-up") {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);
                query.nextFollowUpDate = { $gte: today, $lt: tomorrow };
            }
            else if (status === "Pending Follow-up") {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                query.nextFollowUpDate = { $lt: today };
            }
            else if (status === "Upcoming Follow-up") {
                const tomorrow = new Date();
                tomorrow.setHours(0, 0, 0, 0);
                tomorrow.setDate(tomorrow.getDate() + 1);
                query.nextFollowUpDate = { $gte: tomorrow };
            }
            else if (status === "Lead Observer") {
                query.observer = req.user._id;
            }
            else if (status === "Customer") {
                query.customerType = 'Customer';
            }
            else if (status === "Dealer") {
                query.customerType = 'Dealer';
            }
            else if (status === "New Leads") {
                query.status = 'New';
            }
            else {
                query.status = status;
            }
        }
        if (stage && stage !== 'all')
            query.stage = stage;
        if (assignedTo && assignedTo !== 'all') {
            if (assignedTo.toLowerCase() === 'unassigned') {
                query.assignedTo = { $in: [null, undefined] };
            }
            else {
                query.assignedTo = assignedTo;
            }
        }
        // Advanced filters
        if (state)
            query.state = { $regex: state, $options: 'i' };
        if (city)
            query.city = { $regex: city, $options: 'i' };
        if (source)
            query.source = source;
        if (customerType)
            query.customerType = customerType;
        // Date range filters
        if (enquiryDateFrom || enquiryDateTo) {
            query.enquiryDate = {};
            if (enquiryDateFrom)
                query.enquiryDate.$gte = new Date(enquiryDateFrom);
            if (enquiryDateTo)
                query.enquiryDate.$lte = new Date(enquiryDateTo);
        }
        if (nextFollowUpDateFrom || nextFollowUpDateTo) {
            query.nextFollowUpDate = {};
            if (nextFollowUpDateFrom)
                query.nextFollowUpDate.$gte = new Date(nextFollowUpDateFrom);
            if (nextFollowUpDateTo)
                query.nextFollowUpDate.$lte = new Date(nextFollowUpDateTo);
        }
        if (search) {
            andConditions.push({
                $or: [
                    { companyName: { $regex: search, $options: 'i' } },
                    { contactPerson: { $regex: search, $options: 'i' } },
                    { mobile: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } },
                    { leadCode: { $regex: search, $options: 'i' } },
                    { productRequired: { $regex: search, $options: 'i' } }
                ]
            });
        }
        if (andConditions.length > 0) {
            query.$and = andConditions;
        }
        // Sorting
        let sortOptions = {};
        if (sortBy === 'date' || sortBy === 'createdAt') {
            sortOptions.createdAt = order === 'asc' ? 1 : -1;
        }
        else if (sortBy === 'value') {
            sortOptions.dealValue = order === 'asc' ? 1 : -1;
        }
        else {
            sortOptions[sortBy] = order === 'asc' ? 1 : -1;
        }
        const leads = yield Lead_js_1.default.find(query)
            .populate('assignedTo', 'fullName username')
            .populate('observer', 'fullName username')
            .populate('history.performedBy', 'fullName username')
            .sort(sortOptions)
            .limit(parseInt(limit));
        res.json({ success: true, count: leads.length, leads });
    }
    catch (error) {
        console.error('Error fetching leads:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});
exports.getLeads = getLeads;
// Get single lead by ID
const getLeadById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const lead = yield Lead_js_1.default.findById(req.params.id)
            .populate('assignedTo', 'fullName username')
            .populate('observer', 'fullName username')
            .populate('history.performedBy', 'fullName username');
        if (!lead)
            return res.status(404).json({ success: false, message: 'Lead not found' });
        res.json({ success: true, lead });
    }
    catch (error) {
        console.error('Error fetching lead:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});
exports.getLeadById = getLeadById;
// Update lead
const updateLead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const lead = yield Lead_js_1.default.findById(req.params.id);
        if (!lead)
            return res.status(404).json({ success: false, message: 'Lead not found' });
        const updates = req.body;
        // Log history if status changed
        if (updates.status && updates.status !== lead.status) {
            lead.history.push({
                action: 'Lead Status Updated',
                notes: `Lead status changed from '${lead.status || 'N/A'}' to '${updates.status}'`,
                performedBy: req.user._id
            });
        }
        // Log history if stage changed
        if (updates.stage && updates.stage !== lead.stage) {
            lead.history.push({
                action: 'Lead Stage Updated',
                notes: `Lead stage changed from '${lead.stage || 'N/A'}' to '${updates.stage}'`,
                performedBy: req.user._id
            });
        }
        // Log history if notes are added
        if (updates.notes && Array.isArray(updates.notes) && updates.notes.length > (lead.notes || []).length) {
            const newNote = updates.notes[updates.notes.length - 1];
            lead.history.push({
                action: 'Note Added',
                notes: `Added note: "${newNote.content}"`,
                performedBy: req.user._id
            });
        }
        Object.assign(lead, updates);
        yield lead.save();
        res.json({ success: true, message: 'Lead updated successfully', lead });
    }
    catch (error) {
        console.error('Error updating lead:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});
exports.updateLead = updateLead;
// Delete lead
const deleteLead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const lead = yield Lead_js_1.default.findByIdAndDelete(req.params.id);
        if (!lead)
            return res.status(404).json({ success: false, message: 'Lead not found' });
        res.json({ success: true, message: 'Lead deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting lead:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});
exports.deleteLead = deleteLead;
// Check if lead exists by email or mobile
const checkExistingLead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, mobile } = req.query;
        const query = { companyId: req.user.companyId };
        if (email && mobile) {
            query.$or = [{ email }, { mobile }];
        }
        else if (email) {
            query.email = email;
        }
        else if (mobile) {
            query.mobile = mobile;
        }
        else {
            return res.status(400).json({ success: false, message: 'Email or Mobile required' });
        }
        const lead = yield Lead_js_1.default.findOne(query);
        res.json({ success: true, exists: !!lead, lead });
    }
    catch (error) {
        console.error('Error checking lead:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});
exports.checkExistingLead = checkExistingLead;
// Get users assignable to leads
const getAssignableUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const currentUser = yield User_js_1.default.findById(req.user._id).populate('designationId');
        const isCruncher = ((_a = currentUser === null || currentUser === void 0 ? void 0 : currentUser.designationId) === null || _a === void 0 ? void 0 : _a.name) === 'Cruncher' || ((_b = currentUser === null || currentUser === void 0 ? void 0 : currentUser.designation) === null || _b === void 0 ? void 0 : _b.name) === 'Cruncher';
        let rolesAllowed = ['Sales', 'Sales Employee', 'Sales Head', 'Manager', 'HR-Admin'];
        if (isCruncher) {
            rolesAllowed = ['Sales Employee'];
        }
        const users = yield User_js_1.default.find({
            companyId: req.user.companyId,
            role: { $in: rolesAllowed },
            isActive: true
        }).select('fullName username role employeeId');
        res.json({ success: true, users });
    }
    catch (error) {
        console.error('Error fetching assignable users:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});
exports.getAssignableUsers = getAssignableUsers;
// Mark lead as won and convert to customer/order
const markLeadAsWon = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        console.log(`[Deal Won] Starting conversion for Lead: ${req.params.id}`);
        const lead = yield Lead_js_1.default.findById(req.params.id);
        if (!lead) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }
        if (lead.status === 'Won') {
            return res.status(400).json({ success: false, message: 'Lead already marked as won' });
        }
        if (lead.paymentCheckStatus !== 'Paid' && lead.paymentCheckStatus !== 'Partially Paid') {
            return res.status(400).json({ success: false, message: 'Deal cannot be won until payment is verified by Accounts.' });
        }
        // Ensure we have ObjectId strings, not objects (in case they were populated)
        const companyId = (_b = (((_a = lead.companyId) === null || _a === void 0 ? void 0 : _a._id) || lead.companyId || req.user.companyId)) === null || _b === void 0 ? void 0 : _b.toString();
        const salesPersonId = (_d = (((_c = lead.assignedTo) === null || _c === void 0 ? void 0 : _c._id) || lead.assignedTo || req.user._id)) === null || _d === void 0 ? void 0 : _d.toString();
        const unit = lead.unit || req.user.unit; // Use unit from lead if available, else from creator
        console.log(`[Deal Won] Using CompanyId: ${companyId}, SalesPersonId: ${salesPersonId}, Unit: ${unit}`);
        // 1. Check/Create Customer
        let customer = yield Customer_js_1.default.findOne({
            companyId: companyId,
            $or: [
                { email: lead.email },
                { mobile: lead.mobile }
            ]
        });
        if (!customer) {
            console.log(`[Deal Won] Creating new customer for Lead: ${lead.leadCode}`);
            customer = new Customer_js_1.default({
                name: lead.companyName,
                contactPerson: lead.contactPerson,
                designation: lead.designation,
                mobile: lead.mobile,
                email: lead.email,
                address1: lead.address,
                city: lead.city,
                state: lead.state,
                pin: lead.pincode,
                country: lead.country,
                category: lead.customerType === 'Dealer' ? 'Distributor' : 'End User',
                companyId: companyId,
                salesContact: salesPersonId,
                active: 'Yes',
                advancePayment: lead.advancedPaymentAmount || 0 // Transfer advanced payment
            });
            yield customer.save();
            console.log(`[Deal Won] Customer created: ${customer._id} with advance payment: ₹${lead.advancedPaymentAmount || 0}`);
        }
        else {
            // Update existing customer with advanced payment
            if (lead.advancedPaymentAmount > 0) {
                customer.advancePayment = (customer.advancePayment || 0) + lead.advancedPaymentAmount;
                yield customer.save();
                console.log(`[Deal Won] Updated existing customer ${customer._id} with advance payment: ₹${lead.advancedPaymentAmount}`);
            }
            console.log(`[Deal Won] Existing customer found: ${customer._id}`);
        }
        // 2. Create Order
        const { Item } = yield Promise.resolve().then(() => __importStar(require('../models/Inventory.js')));
        // Improved search for product - check both companyId and store fields
        let item = null;
        if (lead.productRequired) {
            const searchStr = lead.productRequired.trim();
            const escapedProduct = searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            item = yield Item.findOne({
                $and: [
                    {
                        $or: [
                            { companyId: companyId },
                            { store: companyId.toString() }
                        ]
                    },
                    {
                        $or: [
                            { name: { $regex: new RegExp(`^${escapedProduct}$`, 'i') } },
                            { code: searchStr }
                        ]
                    }
                ]
            });
        }
        const Order = (yield Promise.resolve().then(() => __importStar(require('../models/Order.js')))).default;
        let orderCode;
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
            const globalOrderCount = yield Order.countDocuments();
            orderCode = `ORD-${String(globalOrderCount + 1 + attempts).padStart(4, '0')}`;
            const existingOrder = yield Order.findOne({ orderCode });
            if (!existingOrder) {
                isUnique = true;
            }
            else {
                attempts++;
            }
        }
        if (!isUnique) {
            orderCode = `ORD-L-${Date.now().toString().slice(-6)}`;
        }
        const orderProducts = [];
        if (item) {
            orderProducts.push({
                product: item._id,
                quantity: 1,
                price: lead.dealValue || item.salePrice || 0,
                total: lead.dealValue || item.salePrice || 0
            });
        }
        else {
            console.log(`[Deal Won] No specific item found for "${lead.productRequired}", searching for any item for company: ${companyId}`);
            const genericItem = yield Item.findOne({
                $or: [
                    { companyId: companyId },
                    { store: companyId.toString() }
                ]
            });
            if (genericItem) {
                console.log(`[Deal Won] Using generic item: ${genericItem.name} (${genericItem._id})`);
                orderProducts.push({
                    product: genericItem._id,
                    quantity: 1,
                    price: lead.dealValue || 0,
                    total: lead.dealValue || 0
                });
            }
            else {
                console.error(`[Deal Won] CRITICAL: No items found in inventory for company ${companyId}`);
                throw new Error('No items found in inventory to create an order. Please add products first.');
            }
        }
        const totalAmount = orderProducts.reduce((sum, p) => sum + (p.total || 0), 0);
        const newOrder = new Order({
            orderCode,
            customer: customer._id,
            salesPerson: salesPersonId,
            companyId: companyId,
            unit: unit,
            orderDate: new Date(),
            products: orderProducts,
            totalAmount: totalAmount,
            status: 'pending_service_approval', // 🔄 NEW: Requires service verification
            leadId: lead._id, // 📋 NEW: Track Lead-to-Order conversion
            serviceVerification: {
                status: 'pending',
                remarks: 'Awaiting service team verification for deal won from lead'
            },
            notes: `Order generated from Lead ${lead.leadCode}. Deal Value: ₹${lead.dealValue || 0}`,
            quotation: lead.quotation // Transfer quotation from lead to order
        });
        yield newOrder.save();
        console.log(`[Deal Won] Order created: ${newOrder.orderCode} (${newOrder._id})`);
        // 3. Update Lead Status
        lead.status = 'Won';
        lead.history.push({
            action: 'Deal Won',
            notes: `Lead converted to customer and order created (${orderCode}). Advanced payment: ₹${lead.advancedPaymentAmount || 0}`,
            performedBy: req.user._id
        });
        yield lead.save();
        console.log(`[Deal Won] Lead status updated to Won`);
        // 4. Transfer advanced payment to customer master (handled above in customer creation/update)
        res.json({
            success: true,
            message: 'Lead successfully converted to customer and order created',
            customer,
            order: newOrder,
            advancedPaymentTransferred: lead.advancedPaymentAmount || 0
        });
    }
    catch (error) {
        console.error('[Deal Won] Error marking lead as won:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});
exports.markLeadAsWon = markLeadAsWon;
// Request Payment Check
const requestPaymentCheck = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const lead = yield Lead_js_1.default.findById(req.params.id);
        if (!lead)
            return res.status(404).json({ success: false, message: 'Lead not found' });
        if (!lead.quotation)
            return res.status(400).json({ success: false, message: 'Please send Quotation first.' });
        // Import LeadPayment model to check for advanced payments
        const LeadPayment = (yield Promise.resolve().then(() => __importStar(require('../models/LeadPayment.js')))).default;
        // Get verified advanced payments for this lead
        const verifiedPayments = yield LeadPayment.find({
            leadId: req.params.id,
            status: 'Verified'
        });
        const totalAdvancedPayment = verifiedPayments.reduce((sum, p) => sum + p.amount, 0);
        lead.paymentCheckStatus = 'Pending';
        lead.advancedPaymentAmount = totalAdvancedPayment; // Update lead with current advanced payment
        lead.history.push({
            action: 'Payment Check Requested',
            notes: `Sales requested account verification for payment. Advanced payment: ₹${totalAdvancedPayment}`,
            performedBy: req.user._id
        });
        yield lead.save();
        res.json({
            success: true,
            message: 'Payment check requested',
            lead,
            advancedPayment: totalAdvancedPayment
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});
exports.requestPaymentCheck = requestPaymentCheck;
// Update Payment Check Status (By Accounts)
const updatePaymentCheckStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, remarks } = req.body;
        const lead = yield Lead_js_1.default.findById(req.params.id);
        if (!lead)
            return res.status(404).json({ success: false, message: 'Lead not found' });
        lead.paymentCheckStatus = status;
        lead.history.push({
            action: 'Payment Check Updated',
            notes: `Account updated payment status to ${status}. Remarks: ${remarks || ''}`,
            performedBy: req.user._id
        });
        yield lead.save();
        res.json({ success: true, message: 'Payment status updated', lead });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});
exports.updatePaymentCheckStatus = updatePaymentCheckStatus;
// Send Lead to Account for Advanced Payment
const sendLeadToAccount = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const lead = yield Lead_js_1.default.findById(req.params.id);
        if (!lead)
            return res.status(404).json({ success: false, message: 'Lead not found' });
        if (lead.sentToAccount) {
            return res.status(400).json({ success: false, message: 'Lead already sent to account' });
        }
        lead.sentToAccount = true;
        lead.sentToAccountDate = new Date();
        lead.history.push({
            action: 'Sent to Account',
            notes: 'Lead sent to Account for advanced payment processing',
            performedBy: req.user._id
        });
        yield lead.save();
        res.json({ success: true, message: 'Lead sent to Account successfully', lead });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});
exports.sendLeadToAccount = sendLeadToAccount;
