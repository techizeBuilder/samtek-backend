import Lead from '../models/Lead.js';
import User from '../models/User.js';
import Customer from '../models/Customer.js';
import mongoose from 'mongoose';
import ApiSettings from '../models/ApiSettings.js';
import CallLog from '../models/CallLog.js';
import notificationService from '../services/notificationService.js';
// Using global fetch (Node 18+)

// Create new lead
export const createLead = async (req, res) => {
  try {
    const leadData = req.body;

    // ─── Server-side Validation ──────────────────────────────────
    const errors = [];

    // Required fields
    if (!leadData.productRequired || !leadData.productRequired.trim()) {
      errors.push('Product / Service Required field fill karein');
    }
    if (!leadData.contactPerson || !leadData.contactPerson.trim()) {
      errors.push('Contact Person fill karein');
    }
    if (!leadData.companyName || !leadData.companyName.trim()) {
      errors.push('Company Name fill karein');
    }
    if (!leadData.source || !leadData.source.trim()) {
      errors.push('Source field fill karein');
    }
    // At least email or mobile required
    if (!leadData.email && !leadData.mobile) {
      errors.push('Email ya Mobile number mein se ek zaroor enter karein');
    }
    // Email format
    if (leadData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadData.email.trim())) {
      errors.push('Sahi email format enter karein');
    }
    // Mobile: 10 digits only
    if (leadData.mobile && !/^[0-9]{10}$/.test(leadData.mobile.trim())) {
      errors.push('Mobile number sirf 10 digits ka hona chahiye');
    }
    // Alternate mobile
    if (leadData.alternateMobile && !/^[0-9]{10}$/.test(leadData.alternateMobile.trim())) {
      errors.push('Alternate Mobile sirf 10 digits ka hona chahiye');
    }
    // Alternate email
    if (leadData.alternateEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadData.alternateEmail.trim())) {
      errors.push('Sahi alternate email format enter karein');
    }
    // Pincode: max 6 digits
    if (leadData.pincode && !/^[0-9]{1,6}$/.test(leadData.pincode.trim())) {
      errors.push('Pincode mein sirf numbers enter karein (max 6 digits)');
    }
    // GST: 15 alphanumeric
    if (leadData.gstNumber && !/^[0-9A-Z]{15}$/.test(leadData.gstNumber.trim().toUpperCase())) {
      errors.push('GST Number 15 characters ka hona chahiye');
    }
    // PAN: ABCDE1234F format
    if (leadData.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(leadData.pan.trim().toUpperCase())) {
      errors.push('PAN format sahi nahi hai (e.g. ABCDE1234F)');
    }
    // Text-only fields
    const textOnlyFields = { contactPerson: 'Contact Person', designation: 'Designation', state: 'State', city: 'City', profile: 'Profile' };
    for (const [field, label] of Object.entries(textOnlyFields)) {
      if (leadData[field] && /[0-9]/.test(leadData[field])) {
        errors.push(`${label} mein sirf text enter karein (numbers allowed nahi)`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors[0], errors });
    }
    // ─────────────────────────────────────────────────────────────

    // Auto-generate lead code (e.g., LD-0001)
    const count = await Lead.countDocuments({ companyId: req.user.companyId });
    const leadCode = `LD-${String(count + 1).padStart(4, '0')}`;

    const newLead = new Lead({
      ...leadData,
      leadCode,
      companyId: req.user.companyId,
      assignedTo: leadData.assignedTo || req.user._id,
      history: [{
        action: 'Lead Created',
        notes: 'Initial lead entry',
        performedBy: req.user._id
      }]
    });

    await newLead.save();

    // 🔔 Notify Sales Head when new lead created
    try {
      await notificationService.triggerSalesNotification({
        action: 'lead_created',
        orderData: { _id: newLead._id, leadCode: newLead.leadCode, companyName: newLead.companyName },
        targetCompanyId: req.user.companyId,
      });
    } catch (e) { console.error('Lead create notification error:', e); }

    res.status(201).json({ success: true, message: 'Lead created successfully', lead: newLead });
  } catch (error) {
    console.error('Error creating lead:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get all leads for a company with filtering
export const getLeads = async (req, res) => {
  try {
    const {
      status,
      stage,
      assignedTo,
      search,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      order = 'desc',
      state,
      city,
      source,
      customerType,
      enquiryDateFrom,
      enquiryDateTo,
      nextFollowUpDateFrom,
      nextFollowUpDateTo,
      paymentCheckRequested,
      paymentCheckStatusFilter
    } = req.query;

    let parsedLimit = parseInt(limit);
    if (paymentCheckRequested === 'true' && !req.query.limit) {
      parsedLimit = 1000;
    }
    const parsedPage = parseInt(page) || 1;
    const skip = (parsedPage - 1) * parsedLimit;

    const query = { companyId: req.user.companyId };
    const andConditions = [];

    if (paymentCheckRequested === 'true') {
      // Payment Verifications' own status filter (Paid/Pending/Partially
      // Paid/Rejected) narrows further than the base "has a payment check
      // request at all" set.
      if (paymentCheckStatusFilter && paymentCheckStatusFilter !== 'all') {
        query.paymentCheckStatus = paymentCheckStatusFilter;
      } else {
        query.paymentCheckStatus = { $in: ['Pending', 'Paid', 'Partially Paid', 'Rejected'] };
      }
    }

    // ðŸŽ¯ NEW ROLE-BASED ACCESS CONTROL
    const currentUser = await User.findById(req.user._id).populate('designationId');
    
    // Check if user is Cruncher (can see ALL leads + assign)
    const isCruncher = currentUser?.designationId?.name === 'Cruncher' || 
                      currentUser?.designation?.name === 'Cruncher' ||
                      (currentUser?.role === 'Sales Employee' && currentUser?.designation === 'Cruncher');
    
    // Check if user is Sales Head (can see ALL leads + assign)
    const isSalesHead = ['Sales Head', 'Manager', 'Super Admin', 'Superadmin'].includes(req.user.role);
    
    // Check if user is Accounts (for payment verification)
    const isAccounts = ['Accounts', 'Accounts Head', 'Account Employee', 'Finance Manager'].includes(req.user.role);
    
    // Check if user is regular Sales Employee (can see ONLY assigned leads)
    const isSalesEmployee = ['Sales', 'Sales Employee'].includes(req.user.role) && !isCruncher;

    console.log(`ðŸ” Lead Access Control - User: ${req.user.username}, Role: ${req.user.role}, Designation: ${currentUser?.designationId?.name || currentUser?.designation}, isCruncher: ${isCruncher}, isSalesHead: ${isSalesHead}, isSalesEmployee: ${isSalesEmployee}`);

    // ðŸš« VISIBILITY RULES:
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
      console.log(`ðŸ”’ Restricted access for Sales Employee: ${req.user.username} - Only assigned leads`);
    } else if (isAccounts && !isSalesHead) {
      // Accounts can see leads sent to account or payment check requested
      andConditions.push({
        $or: [
          { sentToAccount: true },
          { paymentCheckStatus: { $in: ['Pending', 'Paid', 'Partially Paid', 'Rejected'] } }
        ]
      });
      console.log(`ðŸ’° Accounts access for: ${req.user.username} - Payment related leads only`);
    }
    // Cruncher and Sales Head get full access (no additional conditions)

    // Basic filters
    if (status && status !== 'all' && status !== 'All Active Leads') {
      if (status === "Unassigned Leads") {
        // Cruncher/Sales Head sees leads with no assignee — IndiaMART + other unassigned
        query.assignedTo = { $in: [null, undefined] };
      } else if (status === "Today's Follow-up") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        query.nextFollowUpDate = { $gte: today, $lt: tomorrow };
      } else if (status === "Pending Follow-up") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        query.nextFollowUpDate = { $lt: today };
      } else if (status === "Upcoming Follow-up") {
        const tomorrow = new Date();
        tomorrow.setHours(0, 0, 0, 0);
        tomorrow.setDate(tomorrow.getDate() + 1);
        query.nextFollowUpDate = { $gte: tomorrow };
      } else if (status === "Lead Observer") {
        query.observer = req.user._id;
      } else if (status === "Customer") {
        query.customerType = 'Customer';
      } else if (status === "Dealer") {
        query.customerType = 'Dealer';
      } else if (status === "New Leads") {
        query.status = 'New';
      } else {
        query.status = status;
      }
    }

    if (stage && stage !== 'all') query.stage = stage;
    if (assignedTo && assignedTo !== 'all') {
      if (assignedTo.toLowerCase() === 'unassigned') {
        query.assignedTo = { $in: [null, undefined] };
      } else {
        query.assignedTo = assignedTo;
      }
    }

    // Advanced filters
    if (state) query.state = { $regex: state, $options: 'i' };
    if (city) query.city = { $regex: city, $options: 'i' };
    if (source) query.source = source;
    if (customerType) query.customerType = customerType;

    // Date range filters
    if (enquiryDateFrom || enquiryDateTo) {
      query.enquiryDate = {};
      if (enquiryDateFrom) query.enquiryDate.$gte = new Date(enquiryDateFrom);
      if (enquiryDateTo) query.enquiryDate.$lte = new Date(enquiryDateTo);
    }

    if (nextFollowUpDateFrom || nextFollowUpDateTo) {
      query.nextFollowUpDate = {};
      if (nextFollowUpDateFrom) query.nextFollowUpDate.$gte = new Date(nextFollowUpDateFrom);
      if (nextFollowUpDateTo) query.nextFollowUpDate.$lte = new Date(nextFollowUpDateTo);
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
    if (paymentCheckRequested === 'true') {
      // Payment verifications queue: newest request first (LIFO)
      sortOptions.paymentCheckRequestedAt = -1;
      sortOptions.createdAt = -1;
    } else if (sortBy === 'date' || sortBy === 'createdAt') {
      sortOptions.createdAt = order === 'asc' ? 1 : -1;
    } else if (sortBy === 'value') {
      sortOptions.dealValue = order === 'asc' ? 1 : -1;
    } else {
      sortOptions[sortBy] = order === 'asc' ? 1 : -1;
    }

    const [leadsDocs, total] = await Promise.all([
      Lead.find(query)
        .select('-quotation')
        .populate('assignedTo', 'fullName username')
        .populate('observer', 'fullName username')
        .populate('history.performedBy', 'fullName username')
        .sort(sortOptions)
        .skip(skip)
        .limit(parsedLimit),
      Lead.countDocuments(query),
    ]);

    // Efficiently check which leads have a quotation
    const leadIds = leadsDocs.map(l => l._id);
    const quotes = await Lead.find({ _id: { $in: leadIds }, quotation: { $exists: true, $ne: "" } }).select('_id');
    const quoteSet = new Set(quotes.map(q => q._id.toString()));

    // Efficiently check Order Form status per lead (Not Filled / Submitted / Returned) —
    // drives the "Fill Order Form" button on the Leads page. No field stored on Lead
    // itself; computed here the same way hasQuotation is, to avoid a second source of truth.
    const OrderForm = (await import('../models/OrderForm.js')).default;
    const forms = await OrderForm.find({ leadId: { $in: leadIds } }).select('leadId status');
    const formStatusMap = new Map(forms.map(f => [f.leadId.toString(), f.status]));

    const leads = leadsDocs.map(l => {
      const doc = l.toObject();
      doc.hasQuotation = quoteSet.has(doc._id.toString());
      doc.orderFormStatus = formStatusMap.get(doc._id.toString()) || null;
      return doc;
    });

    // Payment Verifications' 4 stat cards (Total/Pending/Verified/Rejected)
    // need to reflect every payment-check-requested lead, not just the
    // current page — computed here via a small aggregate, independent of
    // paymentCheckStatusFilter, same "always show all statuses" convention
    // used by the Orders/Job Cards stat bars elsewhere in this app.
    let paymentCheckSummary;
    if (paymentCheckRequested === 'true') {
      const statusAgg = await Lead.aggregate([
        { $match: { companyId: new mongoose.Types.ObjectId(req.user.companyId), paymentCheckStatus: { $in: ['Pending', 'Paid', 'Partially Paid', 'Rejected'] } } },
        { $group: { _id: '$paymentCheckStatus', count: { $sum: 1 } } },
      ]);
      const countFrom = (key) => (statusAgg.find(a => a._id === key)?.count) || 0;
      paymentCheckSummary = {
        total: statusAgg.reduce((sum, a) => sum + a.count, 0),
        pending: countFrom('Pending'),
        verified: countFrom('Paid') + countFrom('Partially Paid'),
        rejected: countFrom('Rejected'),
      };
    }

    res.json({
      success: true,
      count: leads.length,
      leads,
      pagination: { page: parsedPage, limit: parsedLimit, total, pages: Math.ceil(total / parsedLimit) },
      ...(paymentCheckSummary ? { paymentCheckSummary } : {}),
    });
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get single lead by ID
export const getLeadById = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('assignedTo', 'fullName username')
      .populate('observer', 'fullName username')
      .populate('history.performedBy', 'fullName username');

    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    res.json({ success: true, lead });
  } catch (error) {
    console.error('Error fetching lead:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get only the quotation PDF for a lead (lightweight endpoint)
export const getLeadQuotation = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).select('quotation leadCode');
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!lead.quotation) return res.status(404).json({ success: false, message: 'No quotation found for this lead' });
    res.json({ success: true, quotation: lead.quotation, leadCode: lead.leadCode });
  } catch (error) {
    console.error('Error fetching lead quotation:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Update lead
export const updateLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    const updates = req.body;

    // Deal Won requires Accounts-verified payment (full or partial) — same rule as markLeadAsWon
    const wantsWon = (updates.status === 'Won' && lead.status !== 'Won') ||
                     (updates.stage === 'Deal Won' && lead.stage !== 'Deal Won');
    if (wantsWon && lead.paymentCheckStatus !== 'Paid' && lead.paymentCheckStatus !== 'Partially Paid') {
      return res.status(400).json({ success: false, message: 'Deal cannot be won until payment is verified by Accounts (partial payment is also accepted).' });
    }

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

    // Check if lead is being assigned to a new person
    const isNewAssignment = updates.assignedTo && String(updates.assignedTo) !== String(lead.assignedTo);

    Object.assign(lead, updates);
    await lead.save();

    // 🔔 Notify if lead assigned to someone
    if (isNewAssignment) {
      try {
        await notificationService.triggerSalesNotification({
          action: 'lead_assigned',
          orderData: { _id: lead._id, leadCode: lead.leadCode, assignedTo: updates.assignedTo },
          targetCompanyId: req.user.companyId,
        });
      } catch (e) { console.error('Lead assign notification error:', e); }
    }


    res.json({ success: true, message: 'Lead updated successfully', lead });
  } catch (error) {
    console.error('Error updating lead:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Delete lead
export const deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (error) {
    console.error('Error deleting lead:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Check if lead exists by email or mobile
export const checkExistingLead = async (req, res) => {
  try {
    const { email, mobile } = req.query;
    const query = { companyId: req.user.companyId };

    if (email && mobile) {
      query.$or = [{ email }, { mobile }];
    } else if (email) {
      query.email = email;
    } else if (mobile) {
      query.mobile = mobile;
    } else {
      return res.status(400).json({ success: false, message: 'Email or Mobile required' });
    }

    const lead = await Lead.findOne(query);
    res.json({ success: true, exists: !!lead, lead });
  } catch (error) {
    console.error('Error checking lead:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get users assignable to leads
export const getAssignableUsers = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).populate('designationId');
    const isCruncher = currentUser?.designationId?.name === 'Cruncher' || currentUser?.designation?.name === 'Cruncher';

    let rolesAllowed = ['Sales', 'Sales Employee', 'Sales Head', 'Manager', 'HR-Admin'];
    if (isCruncher) {
      rolesAllowed = ['Sales Employee'];
    }

    const users = await User.find({
      companyId: req.user.companyId,
      role: { $in: rolesAllowed },
      isActive: true
    }).select('fullName username role employeeId');

    res.json({ success: true, users });
  } catch (error) {
    console.error('Error fetching assignable users:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Mark lead as won and convert to customer/order
export const markLeadAsWon = async (req, res) => {
  try {
    const { salesChecklist } = req.body;
    console.log(`[Deal Won] Starting conversion for Lead: ${req.params.id}, checklist:`, salesChecklist);
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    if (lead.status === 'Won') {
      return res.status(400).json({ success: false, message: 'Lead already marked as won' });
    }

    if (lead.paymentCheckStatus !== 'Paid' && lead.paymentCheckStatus !== 'Partially Paid') {
      return res.status(400).json({ success: false, message: 'Deal cannot be won until payment is verified by Accounts.' });
    }

    const companyId = (lead.companyId?._id || lead.companyId || req.user.companyId)?.toString();
    const salesPersonId = (lead.assignedTo?._id || lead.assignedTo || req.user._id)?.toString();
    const unit = lead.unit || req.user.unit;

    console.log(`[Deal Won] Using CompanyId: ${companyId}, SalesPersonId: ${salesPersonId}, Unit: ${unit}`);

    const { Item } = await import('../models/Inventory.js');
    let item = null;
    if (lead.productRequired) {
      const searchStr = lead.productRequired.trim();
      const escapedProduct = searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      item = await Item.findOne({
        $and: [
          { $or: [{ companyId: companyId }, { store: companyId.toString() }] },
          { $or: [{ name: { $regex: new RegExp(`^${escapedProduct}$`, 'i') } }, { code: searchStr }] }
        ]
      });
    }

    const orderProducts = [];
    if (item) {
      orderProducts.push({ product: item._id, quantity: 1, price: lead.dealValue || item.salePrice || 0, total: lead.dealValue || item.salePrice || 0 });
    } else {
      const genericItem = await Item.findOne({ $or: [{ companyId: companyId }, { store: companyId.toString() }] });
      if (genericItem) {
        orderProducts.push({ product: genericItem._id, quantity: 1, price: lead.dealValue || 0, total: lead.dealValue || 0 });
      } else {
        throw new Error('No items found in inventory to create an order. Please add products first.');
      }
    }

    const totalAmount = orderProducts.reduce((sum, p) => sum + (p.total || 0), 0);

    let customer = await Customer.findOne({
      companyId: companyId,
      $or: [{ email: lead.email }, { mobile: lead.mobile }]
    });

    if (!customer) {
      console.log(`[Deal Won] Creating new customer for Lead: ${lead.leadCode}`);
      customer = new Customer({
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
        advancePayment: lead.advancedPaymentAmount || 0,
        // Outstanding starts at 0 — it's populated once the salesperson
        // submits the Sales Order Form (see orderFormController.js:
        // upsertOrderForm), using the Order Form's Bill Amount minus this
        // lead's advance payment, not the quotation amount.
        outstandingAmount: 0
      });
      await customer.save();
    } else {
      // Existing customer — advance payment is still tracked at Deal Won time;
      // Outstanding itself is populated later, at Order Form submission.
      if (lead.advancedPaymentAmount > 0) {
        customer.advancePayment = (customer.advancePayment || 0) + lead.advancedPaymentAmount;
      }
      await customer.save();
    }

    const Order = (await import('../models/Order.js')).default;
    let orderCode;
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      const globalOrderCount = await Order.countDocuments();
      orderCode = `ORD-${String(globalOrderCount + 1 + attempts).padStart(4, '0')}`;
      const existingOrder = await Order.findOne({ orderCode });
      if (!existingOrder) { isUnique = true; } else { attempts++; }
    }
    if (!isUnique) orderCode = `ORD-L-${Date.now().toString().slice(-6)}`;

    const newOrder = new Order({
      orderCode,
      customer: customer._id,
      salesPerson: salesPersonId,
      companyId: companyId,
      unit: unit,
      orderDate: new Date(),
      products: orderProducts,
      totalAmount: totalAmount,
      status: 'pending_service_approval',
      leadId: lead._id,
      serviceVerification: { status: 'pending', remarks: 'Awaiting service team verification for deal won from lead' },
      notes: `Order generated from Lead ${lead.leadCode}. Deal Value: ₹${lead.dealValue || 0}`,
      quotation: lead.quotation,
      salesChecklist: salesChecklist || {}
    });

    await newOrder.save();

    lead.status = 'Won';
    lead.history.push({
      action: 'Deal Won',
      notes: `Lead converted to customer and order created (${orderCode}). Advanced payment: ₹${lead.advancedPaymentAmount || 0}`,
      performedBy: req.user._id
    });
    await lead.save();

    // 🔔 Notify Complaint Management team for Deal Verification
    try {
      await notificationService.triggerComplaintNotification({
        action: 'deal_verification_required',
        data: {
          leadId: lead._id,
          leadCode: lead.leadCode,
          orderId: newOrder._id,
          orderCode: newOrder.orderCode,
          customerName: customer.name || lead.companyName,
          dealValue: lead.dealValue || 0,
        },
        targetCompanyId: companyId,
      });
    } catch (e) { console.error('Deal won - complaint notification error:', e); }

    res.json({ success: true, message: 'Lead successfully converted to customer and order created', customer, order: newOrder, advancedPaymentTransferred: lead.advancedPaymentAmount || 0 });
  } catch (error) {
    console.error('[Deal Won] Error marking lead as won:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Request Payment Check
export const requestPaymentCheck = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!lead.quotation) return res.status(400).json({ success: false, message: 'Please send Quotation first.' });

    const LeadPayment = (await import('../models/LeadPayment.js')).default;
    const verifiedPayments = await LeadPayment.find({ leadId: req.params.id, status: 'Verified' });
    const totalAdvancedPayment = verifiedPayments.reduce((sum, p) => sum + p.amount, 0);

    lead.paymentCheckStatus = 'Pending';
    lead.paymentCheckRequestedAt = new Date();
    lead.advancedPaymentAmount = totalAdvancedPayment;
    lead.history.push({
      action: 'Payment Check Requested',
      notes: `Sales requested account verification for payment. Advanced payment: â‚¹${totalAdvancedPayment}`,
      performedBy: req.user._id
    });
    await lead.save();

    // 🔔 Notify Accounts about payment check request
    try {
      await notificationService.triggerSalesNotification({
        action: 'payment_check_requested',
        orderData: { _id: lead._id, leadCode: lead.leadCode },
        targetCompanyId: req.user.companyId,
      });
    } catch (e) { console.error('Payment check notification error:', e); }

    res.json({ success: true, message: 'Payment check requested', lead, advancedPayment: totalAdvancedPayment });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Update Payment Check Status (By Accounts)
export const updatePaymentCheckStatus = async (req, res) => {
  try {
    const { status, remarks } = req.body;
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    lead.paymentCheckStatus = status;
    lead.history.push({
      action: 'Payment Check Updated',
      notes: `Account updated payment status to ${status}. Remarks: ${remarks || ''}`,
      performedBy: req.user._id
    });

    await lead.save();

    // 🔔 Notify Sales that payment status was updated
    try {
      await notificationService.triggerSalesNotification({
        action: 'payment_verified',
        orderData: { _id: lead._id, leadCode: lead.leadCode, status },
        targetCompanyId: req.user.companyId,
      });
    } catch (e) { console.error('Payment verified notification error:', e); }

    res.json({ success: true, message: 'Payment status updated', lead });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Send Lead to Account for Advanced Payment
export const sendLeadToAccount = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

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

    await lead.save();

    // 🔔 Notify Accounts that lead is sent for payment
    try {
      await notificationService.triggerSalesNotification({
        action: 'lead_sent_to_account',
        orderData: { _id: lead._id, leadCode: lead.leadCode },
        targetCompanyId: req.user.companyId,
      });
    } catch (e) { console.error('Lead to account notification error:', e); }

    res.json({ success: true, message: 'Lead sent to Account successfully', lead });
  } catch (error) {
    console.error('Error sending lead to account:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Add a single document to lead's documents array (Manage Document List modal)
export const addLeadDocument = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const { docType } = req.body;
    if (!docType) {
      return res.status(400).json({ success: false, message: 'Document type is required' });
    }

    const newDoc = {
      type: docType,
      name: req.file.originalname,
      url: `/uploads/lead-documents/${req.file.filename}`,
      uploadedAt: new Date()
    };

    lead.documents = [...(lead.documents || []), newDoc];
    lead.history.push({
      action: 'Document Uploaded',
      notes: `Document uploaded: ${docType} (${req.file.originalname})`,
      performedBy: req.user._id
    });

    await lead.save();

    res.json({
      success: true,
      message: 'Document uploaded successfully',
      document: newDoc,
      documents: lead.documents
    });
  } catch (error) {
    console.error('Error adding lead document:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Upload Documents for Lead (PO, Payment Proof, Quotation) — called before Go to Account
export const uploadLeadDocuments = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    const files = req.files; // { po: [...], paymentProof: [...], quotation: [...] }
    if (!files || Object.keys(files).length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const newDocs = [];

    const fieldDocTypeMap = {
      po: 'Purchase Order',
      paymentProof: 'Payment Proof',
      quotation: 'Quotation'
    };

    for (const [fieldName, docType] of Object.entries(fieldDocTypeMap)) {
      const filesForField = files[fieldName];
      if (filesForField && filesForField.length > 0) {
        for (const file of filesForField) {
          newDocs.push({
            docType,
            originalName: file.originalname,
            fileName: file.filename,
            url: `${baseUrl}/uploads/lead-documents/${file.filename}`,
            mimeType: file.mimetype,
            uploadedBy: req.user._id,
            uploadedAt: new Date()
          });
        }
      }
    }

    if (newDocs.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid files found in upload' });
    }

    lead.leadDocuments = [...(lead.leadDocuments || []), ...newDocs];
    lead.history.push({
      action: 'Documents Uploaded',
      notes: `${newDocs.length} document(s) uploaded before sending to account: ${newDocs.map(d => d.docType).join(', ')}`,
      performedBy: req.user._id
    });

    await lead.save();

    res.json({
      success: true,
      message: 'Documents uploaded successfully',
      documents: newDocs,
      lead
    });
  } catch (error) {
    console.error('Error uploading lead documents:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};
// GET API SETTINGS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export const getApiSettings = async (req, res) => {
  try {
    // Super Admin can fetch settings for any company via ?companyId=xxx
    const targetCompanyId = (req.user.role === 'Super Admin' && req.query.companyId)
      ? req.query.companyId
      : req.user.companyId;

    let settings = await ApiSettings.findOne({ companyId: targetCompanyId })
      .populate('indiamart.assignedUserIds', 'fullName username')
      .populate('ivr.assignedUserIds', 'fullName username')
      .populate('website.assignedUserIds', 'fullName username')
      .populate('googleAds.assignedUserIds', 'fullName username');

    if (!settings) {
      settings = await ApiSettings.create({ companyId: targetCompanyId });
    }
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Error fetching API settings:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SAVE API SETTINGS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export const saveApiSettings = async (req, res) => {
  try {
    const { indiamart, ivr, website, googleAds } = req.body;
    // Super Admin can save settings for any company via ?companyId=xxx
    const targetCompanyId = (req.user.role === 'Super Admin' && req.query.companyId)
      ? req.query.companyId
      : req.user.companyId;

    const settings = await ApiSettings.findOneAndUpdate(
      { companyId: targetCompanyId },
      { $set: { indiamart, ivr, website, googleAds } },
      { upsert: true, new: true }
    );
    res.json({ success: true, message: 'API settings saved', settings });
  } catch (error) {
    console.error('Error saving API settings:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SYNC INDIAMART LEADS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export const syncIndiamartLeads = async (req, res) => {
  try {
    const settings = await ApiSettings.findOne({ companyId: req.user.companyId })
      .populate('indiamart.assignedUserIds', 'fullName username _id');

    if (!settings?.indiamart?.enabled) {
      return res.status(400).json({ success: false, message: 'IndiaMART API integration is disabled. Please enable it in API Settings.' });
    }

    let activeAccounts = [];
    if (settings.indiamart.accounts && settings.indiamart.accounts.length > 0) {
      activeAccounts = settings.indiamart.accounts.filter(acc => acc.sellerMobile && acc.authKey);
    } else if (settings.indiamart.sellerMobile && settings.indiamart.authKey) {
      activeAccounts = [{
        apiName: 'Primary Account',
        sellerMobile: settings.indiamart.sellerMobile,
        authKey: settings.indiamart.authKey,
        _id: null
      }];
    }

    if (activeAccounts.length === 0) {
      return res.status(400).json({ success: false, message: 'No active IndiaMART accounts (Seller Mobile & Auth Key) configured. Please configure in API Settings.' });
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 3);
    const fmt = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');

    let imported = 0;
    let skipped = 0;
    let errors = [];

    for (const account of activeAccounts) {
      try {
        const { sellerMobile, authKey, apiName } = account;
        // Correct IndiaMART query URL incorporating GLUSR_MOBILE_KEY
        const url = `https://mapi.indiamart.com/wservce/enquiry/listing/v2/?GLUSR_MOBILE=${sellerMobile}&GLUSR_MOBILE_KEY=${authKey}&START_TIME=${fmt(startDate)}&END_TIME=${fmt(new Date())}&LIMIT=50&FLAG=1`;

        let data;
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const rawText = await response.text();
        console.log(`[IndiaMART - ${apiName || sellerMobile}] HTTP ${response.status} — Raw response: ${rawText.substring(0, 300)}`);
        
        try {
          data = JSON.parse(rawText);
        } catch {
          errors.push(`Account ${apiName || sellerMobile}: Non-JSON response returned from API.`);
          continue;
        }

        if (data?.RESPONSE?.length) {
          for (const lead of data.RESPONSE) {
            const queryId = (lead.QUERY_ID || '').trim();
            if (!queryId) continue;

            // Check duplicate using fast indexed field first
            let exists = await Lead.findOne({ companyId: req.user.companyId, indiamartQueryId: queryId });
            if (!exists) {
              // Fallback legacy check to avoid duplicates for older imported leads
              exists = await Lead.findOne({ 
                companyId: req.user.companyId, 
                describeRequirements: { $regex: `QueryID:${queryId}`, $options: 'i' } 
              });
              // Auto-migrate legacy lead to populate indiamartQueryId
              if (exists) {
                exists.indiamartQueryId = queryId;
                await exists.save();
              }
            }
            if (exists) { skipped++; continue; }

            // 🎯 CRUNCHER FLOW: IndiaMART leads are always UNASSIGNED
            // Cruncher will review and manually assign to Sales Employees
            const assignedTo = null;

            const count = await Lead.countDocuments({ companyId: req.user.companyId });
            const leadCode = `LD-${String(count + 1).padStart(4, '0')}`;

            const senderName = lead.SENDER_NAME || lead.SUBJECT || 'IndiaMART Lead';
            const senderMobile = lead.SENDER_MOBILE || lead.SENDER_MOBILE_ALT || '0000000000';
            const senderEmail = lead.SENDER_EMAIL || `indiamartlead_${queryId}@noemail.com`;

            const newLead = new Lead({
              leadCode,
              companyId: req.user.companyId,
              source: 'IndiaMart',
              status: 'New',
              stage: 'N/A',
              productRequired: lead.PRODUCT_NAME || lead.SUBJECT || 'Unknown',
              describeRequirements: `${lead.QUERY_MESSAGE || ''} [QueryID:${queryId}] (Account: ${apiName || 'Default'})`,
              indiamartQueryId: queryId,
              companyName: senderName,
              contactPerson: senderName,
              mobile: senderMobile,
              email: senderEmail,
              address: lead.SENDER_ADDRESS || '',
              assignedTo,
              leadDate: lead.QUERY_TIME ? new Date(lead.QUERY_TIME) : new Date(),
              history: [{
                action: 'Lead Created',
                notes: `Auto-imported from IndiaMART account "${apiName || 'Default'}" (QueryID: ${queryId}) — Pending Cruncher assignment`,
                performedBy: req.user._id
              }]
            });

            await newLead.save();
            imported++;
          }
        }

        // Update lastSyncedAt for this specific account
        if (account._id && settings.indiamart.accounts) {
          const accDoc = settings.indiamart.accounts.id(account._id);
          if (accDoc) accDoc.lastSyncedAt = new Date();
        }
      } catch (accErr) {
        console.error(`[IndiaMART] Sync error for account ${account.apiName || account.sellerMobile}:`, accErr);
        errors.push(`Account ${account.apiName || account.sellerMobile}: ${accErr.message}`);
      }
    }

    // Update global sync time for IndiaMART
    settings.indiamart.lastSyncedAt = new Date();
    await settings.save();

    if (errors.length > 0 && imported === 0) {
      return res.status(502).json({ success: false, message: `Failed to sync IndiaMART leads: ${errors.join(' | ')}` });
    }

    res.json({
      success: true,
      message: `IndiaMART sync complete. Imported: ${imported}, Skipped (duplicates): ${skipped} across ${activeAccounts.length} account(s).${errors.length > 0 ? ` Errors: ${errors.join(' | ')}` : ''}`,
      imported,
      skipped
    });
  } catch (error) {
    console.error('Error syncing IndiaMART leads:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SYNC IVR LEADS (Acefone)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export const syncIvrLeads = async (req, res) => {
  try {
    const settings = await ApiSettings.findOne({ companyId: req.user.companyId })
      .populate('ivr.assignedUserIds', 'fullName username _id');

    if (!settings?.ivr?.enabled || !settings.ivr.apiKey) {
      return res.status(400).json({ success: false, message: 'IVR API not configured or disabled. Please configure in API Settings.' });
    }

    const { apiKey, assignmentRule, assignedUserIds, lastAssignedIndex } = settings.ivr;
    const users = assignedUserIds || [];
    let assignIdx = lastAssignedIndex || 0;

    let data;
    try {
      const response = await fetch(`https://api.acefone.in/get_leads?api_key=${encodeURIComponent(apiKey)}`);
      data = await response.json();
    } catch (fetchErr) {
      return res.status(502).json({ success: false, message: 'Failed to connect to Acefone IVR API. Check API key.' });
    }

    const leads = data?.data || (Array.isArray(data) ? data : []);
    if (!leads.length) {
      return res.json({ success: true, message: 'No new IVR leads found', imported: 0 });
    }

    let imported = 0;
    let skipped = 0;

    for (const ivrLead of leads) {
      const callerNumber = (ivrLead.caller_number || '').trim();
      if (!callerNumber) continue;

      // Check duplicate by mobile
      const exists = await Lead.findOne({ companyId: req.user.companyId, mobile: callerNumber, source: 'IVR' });
      if (exists) { skipped++; continue; }

      let assignedTo = req.user._id;
      if (users.length > 0) {
        if (assignmentRule === 1) { // Random
          assignedTo = users[Math.floor(Math.random() * users.length)]._id;
        } else if (assignmentRule === 2) { // Round Robin
          assignedTo = users[assignIdx % users.length]._id;
          assignIdx++;
        }
      }

      const count = await Lead.countDocuments({ companyId: req.user.companyId });
      const leadCode = `LD-${String(count + 1).padStart(4, '0')}`;

      const newLead = new Lead({
        leadCode,
        companyId: req.user.companyId,
        source: 'IVR',
        status: 'New',
        stage: 'N/A',
        productRequired: ivrLead.ivr_option || ivrLead.subject || 'IVR Call Enquiry',
        describeRequirements: ivrLead.message || `Inbound IVR call from ${callerNumber}`,
        companyName: ivrLead.company_name || ivrLead.caller_name || 'IVR Caller',
        contactPerson: ivrLead.caller_name || `Caller_${callerNumber.slice(-4)}`,
        mobile: callerNumber,
        email: ivrLead.email || `ivr_${callerNumber}@noemail.com`,
        address: ivrLead.address || '',
        assignedTo,
        history: [{
          action: 'Lead Created',
          notes: `Auto-imported from IVR / Acefone (Caller: ${callerNumber})`,
          performedBy: req.user._id
        }]
      });

      await newLead.save();
      imported++;
    }

    await ApiSettings.findOneAndUpdate(
      { companyId: req.user.companyId },
      { 'ivr.lastAssignedIndex': assignIdx, 'ivr.lastSyncedAt': new Date() }
    );

    res.json({ success: true, message: `IVR sync complete. Imported: ${imported}, Skipped: ${skipped}`, imported, skipped });
  } catch (error) {
    console.error('Error syncing IVR leads:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// IVR CALL LOG WEBHOOK (No Auth â€” called by Acefone)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export const receiveIvrCallLog = async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q) return res.status(400).json({ success: false, message: 'Missing API token' });

    // Find company from API key
    const settings = await ApiSettings.findOne({ 'ivr.apiKey': q });
    if (!settings) return res.status(401).json({ success: false, message: 'Unauthorized token' });

    const data = req.body;
    const callId = data.call_id || '';
    if (!callId) return res.status(400).json({ success: false, message: 'Missing call_id' });

    // Check duplicate
    const exists = await CallLog.findOne({ companyId: settings.companyId, callId });
    if (exists) return res.json({ success: true, message: 'Duplicate call ignored' });

    const direction = data.direction || 'inbound';
    const cleanNum = (n) => n ? (n.replace(/\D/g, '')).slice(-10) : '';
    const clientNumber = direction === 'inbound'
      ? cleanNum(data.caller_id_number || data.customer_no_without_prefix)
      : cleanNum(data.call_to_number || data.customer_no_without_prefix);

    let agentName = data?.answered_agent?.name || data.answered_agent_name || '';
    agentName = agentName.replace(/-?\s*Extension/i, '').trim();

    // Try to find linked lead by mobile number
    const linkedLead = await Lead.findOne({ companyId: settings.companyId, mobile: clientNumber });

    const callLog = new CallLog({
      companyId: settings.companyId,
      leadId: linkedLead?._id || null,
      callId,
      uuid: data.uuid || '',
      direction,
      status: data.call_status || '',
      description: data.reason_key || '',
      recordingUrl: data.recording_url || '',
      service: direction === 'clicktocall' ? 'ClickToCall' : 'Inbound',
      clientNumber,
      didNumber: cleanNum(data.call_to_number || data.did_no_without_prefix),
      agentNumber: data?.answered_agent?.agent_number || '',
      agentName,
      callDate: new Date(),
      callDuration: parseFloat(data.duration || 0),
      answeredSeconds: parseFloat(data.billsec || 0),
      minutesConsumed: Math.round(parseFloat(data.billsec || 0) / 60 * 100) / 100,
      hangupCause: data.hangup_cause || '',
      reason: data.reason_key || '',
      source: 'IVR'
    });

    await callLog.save();

    res.json({
      success: true,
      message: 'Call log saved',
      callLogId: callLog._id,
      linkedLeadId: linkedLead?._id || null
    });
  } catch (error) {
    console.error('Error receiving IVR call log:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// WEBSITE WEBHOOK (No Auth â€” called by website forms)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export const receiveWebsiteWebhook = async (req, res) => {
  try {
    const apiKey = req.query.q || req.query.api_key || req.body?.api_key || '';
    if (!apiKey) return res.status(400).json({ success: false, message: 'API Key Missing' });

    const settings = await ApiSettings.findOne({ 'website.apiKey': apiKey })
      .populate('website.assignedUserIds', '_id fullName');
    if (!settings) return res.status(401).json({ success: false, message: 'Invalid API Key' });

    const input = req.body || {};
    const name    = (input.name || input['form_field-name'] || '').trim();
    const mobile  = (input.mobile || input['form_field-mobile'] || '').trim();
    const email   = (input.email || input['form_field-email'] || '').trim();
    const product = (input.product_service || input['form_field-product_service'] || 'General Enquiry').trim();
    const city    = (input.city || input['form_field-city'] || '').trim();
    const state   = (input.state || input['form_field-state'] || '').trim();
    const country = (input.country || 'India').trim();
    const desc    = (input.describe_requirement || input['form_field-describe_requirement'] || '').trim();

    if (!mobile && !email) {
      return res.status(400).json({ success: false, message: 'Mobile or Email required' });
    }

    // No duplicate skip — same as the PHP website webhook: every form
    // submission creates its own lead, even from a repeat visitor (e.g. a
    // genuinely new enquiry 6 months later). PHP keeps one persistent
    // "buyer" record and links each new lead to it; Samtek has no separate
    // buyer entity, so this is simply always-create.

    // Assign user
    const users = settings.website.assignedUserIds || [];
    const assignedTo = users.length > 0
      ? users[Math.floor(Math.random() * users.length)]._id
      : null;

    const count = await Lead.countDocuments({ companyId: settings.companyId });
    const leadCode = `LD-${String(count + 1).padStart(4, '0')}`;

    const newLead = new Lead({
      leadCode,
      companyId: settings.companyId,
      source: 'Website',
      status: 'New',
      stage: 'N/A',
      productRequired: product,
      describeRequirements: desc,
      companyName: name || 'Website Lead',
      contactPerson: name || 'Website Lead',
      mobile: mobile || '0000000000',
      email: email || `website_${Date.now()}@noemail.com`,
      city,
      state,
      country,
      assignedTo,
      history: [{
        action: 'Lead Created',
        notes: `Auto-created from Website Webhook`,
        performedBy: null
      }]
    });

    await newLead.save();
    res.json({ success: true, message: 'Lead created from website', leadId: newLead._id, leadCode });
  } catch (error) {
    console.error('Error receiving website webhook:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// GET CALL LOGS FOR A LEAD
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export const receiveIndiamartWebhook = async (req, res) => {
  try {
    const authKey = req.query.q || req.query.key || '';
    if (!authKey) return res.status(400).json({ success: false, message: 'Missing API key (?q=...)' });

    // Match either the legacy single-account fields or one of the
    // multi-account entries — same dual shape syncIndiamartLeads reads.
    let settings = await ApiSettings.findOne({ 'indiamart.authKey': authKey, 'indiamart.enabled': true });
    let apiName = 'Primary Account';
    let accountDoc = null;
    if (!settings) {
      settings = await ApiSettings.findOne({ 'indiamart.accounts.authKey': authKey, 'indiamart.enabled': true });
      if (settings) {
        accountDoc = settings.indiamart.accounts.find(a => a.authKey === authKey);
        apiName = accountDoc?.apiName || apiName;
      }
    }
    if (!settings) return res.status(401).json({ success: false, message: 'Invalid or inactive IndiaMART API key' });

    const companyId = settings.companyId;

    // IndiaMART posts either { RESPONSE: {...one lead...} } or
    // { RESPONSE: [...several...] } — normalise both to an array.
    const payload = req.body || {};
    let items = [];
    if (Array.isArray(payload.RESPONSE)) items = payload.RESPONSE;
    else if (payload.RESPONSE && typeof payload.RESPONSE === 'object') items = [payload.RESPONSE];
    else if (Array.isArray(payload)) items = payload;
    else if (payload.UNIQUE_QUERY_ID || payload.QUERY_ID) items = [payload];

    if (!items.length) {
      return res.status(400).json({ success: false, message: 'No lead data found in webhook payload' });
    }

    const cleanNum = (n) => n ? String(n).replace(/\D/g, '').slice(-10) : '';
    let imported = 0, skipped = 0;

    for (const item of items) {
      const queryId = String(item.UNIQUE_QUERY_ID || item.QUERY_ID || '').trim();
      if (!queryId) { skipped++; continue; }

      // Same dedup key the polling sync uses, so a lead pushed by the
      // webhook is never re-imported later if polling ever runs too.
      const exists = await Lead.findOne({ companyId, indiamartQueryId: queryId });
      if (exists) { skipped++; continue; }

      const senderName = item.SENDER_NAME || item.SUBJECT || 'IndiaMART Lead';
      const senderMobile = cleanNum(item.SENDER_MOBILE) || cleanNum(item.SENDER_MOBILE_ALT) || '0000000000';

      const count = await Lead.countDocuments({ companyId });
      const leadCode = `LD-${String(count + 1).padStart(4, '0')}`;

      const newLead = new Lead({
        leadCode,
        companyId,
        source: 'IndiaMart',
        status: 'New',
        stage: 'N/A',
        productRequired: item.QUERY_PRODUCT_NAME || item.PRODUCT_NAME || item.SUBJECT || 'Unknown',
        describeRequirements: `${item.QUERY_MESSAGE || ''} [QueryID:${queryId}] (Account: ${apiName})`,
        indiamartQueryId: queryId,
        companyName: item.SENDER_COMPANY || senderName,
        contactPerson: senderName,
        designation: item.DESIGNATION || '',
        mobile: senderMobile,
        alternateMobile: cleanNum(item.SENDER_MOBILE_ALT),
        email: item.SENDER_EMAIL || `indiamartlead_${queryId}@noemail.com`,
        alternateEmail: item.SENDER_EMAIL_ALT || '',
        address: item.SENDER_ADDRESS || '',
        city: item.SENDER_CITY || '',
        state: item.SENDER_STATE || '',
        country: item.SENDER_COUNTRY_ISO || 'India',
        pincode: item.SENDER_PINCODE || '',
        // 🎯 CRUNCHER FLOW: same as the polling sync (syncIndiamartLeads /
        // runBackgroundApiSync) — IndiaMART leads are always UNASSIGNED so
        // both ingestion paths behave identically; Cruncher assigns manually.
        assignedTo: null,
        leadDate: item.QUERY_TIME ? new Date(item.QUERY_TIME) : new Date(),
        history: [{
          action: 'Lead Created',
          notes: `Auto-imported via IndiaMART webhook (Account: ${apiName}, QueryID: ${queryId}) — Pending Cruncher assignment`,
          performedBy: null
        }]
      });

      await newLead.save();
      imported++;
    }

    if (accountDoc) accountDoc.lastSyncedAt = new Date();
    settings.indiamart.lastSyncedAt = new Date();
    await settings.save();

    res.json({ success: true, message: `IndiaMART webhook processed. Imported: ${imported}, Skipped (duplicates): ${skipped}` });
  } catch (error) {
    console.error('Error receiving IndiaMART webhook:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// GOOGLE ADS LEAD FORM WEBHOOK (No Auth — Google Ads pushes each Lead
// Form submission here in real time. Google's protocol is different
// from IndiaMART/Website: it (1) sends a "google_key" field in every
// payload that must match what's configured in Google Ads, and (2)
// requires the response body to be exactly {"google_key": "<same key>"}
// with HTTP 200 — that's how Google verifies the endpoint, both for the
// one-time test call made when the webhook is saved (is_test) and for
// every real lead after. Lead fields arrive as a user_column_data array
// of { column_id, column_name, string_value } — not fixed top-level keys.
// ═══════════════════════════════════════════════════════════════
export const receiveGoogleAdsWebhook = async (req, res) => {
  try {
    const payload = req.body || {};
    const googleKey = req.query.q || payload.google_key || '';

    if (!googleKey) {
      return res.status(400).json({ success: false, message: 'Missing key' });
    }

    const settings = await ApiSettings.findOne({ 'googleAds.webhookKey': googleKey, 'googleAds.enabled': true })
      .populate('googleAds.assignedUserIds', '_id fullName');

    // Google's own key check — the payload's google_key must match what
    // this company configured, independent of the ?q= tenant lookup above.
    if (!settings || payload.google_key !== googleKey) {
      // Still echo the contract shape back so Google's own key-mismatch
      // diagnostics work, just without ever creating a lead.
      return res.status(401).json({ google_key: payload.google_key || '' });
    }

    // Google sends a one-time verification call with is_test truthy when
    // the webhook is first saved (and whenever it's re-validated) — must
    // be acknowledged without creating a real lead.
    const isTest = String(payload.is_test || '').toLowerCase();
    if (isTest === '1' || isTest === 'true') {
      return res.status(200).json({ google_key: googleKey });
    }

    const leadId = String(payload.lead_id || '').trim();
    if (leadId) {
      const exists = await Lead.findOne({ companyId: settings.companyId, googleAdsLeadId: leadId });
      if (exists) {
        return res.status(200).json({ google_key: googleKey });
      }
    }

    // Flatten Google's user_column_data array into a lookup by column_id
    const columns = {};
    for (const col of (payload.user_column_data || [])) {
      const id = (col.column_id || col.column_name || '').toUpperCase();
      if (id) columns[id] = col.string_value || '';
    }

    const name = columns.FULL_NAME || [columns.FIRST_NAME, columns.LAST_NAME].filter(Boolean).join(' ') || 'Google Ads Lead';
    const mobile = (columns.PHONE_NUMBER || columns.WORK_PHONE_NUMBER || '').replace(/\D/g, '').slice(-10) || '0000000000';
    const email = columns.EMAIL || columns.WORK_EMAIL || `googleadslead_${leadId || Date.now()}@noemail.com`;

    // Assign user — same random-pick pattern as the Website webhook
    const users = settings.googleAds.assignedUserIds || [];
    const assignedTo = users.length > 0
      ? users[Math.floor(Math.random() * users.length)]._id
      : null;

    const count = await Lead.countDocuments({ companyId: settings.companyId });
    const leadCode = `LD-${String(count + 1).padStart(4, '0')}`;

    const newLead = new Lead({
      leadCode,
      companyId: settings.companyId,
      source: 'Google Ads',
      status: 'New',
      stage: 'N/A',
      productRequired: columns.LEAD_FORM_NAME || columns.COMPANY_NAME || 'Google Ads Enquiry',
      describeRequirements: [columns.CITY, columns.STATE, columns.POSTAL_CODE].filter(Boolean).join(', ')
        || `Lead from Google Ads campaign ${payload.campaign_name || payload.campaign_id || ''}`,
      googleAdsLeadId: leadId || null,
      companyName: columns.COMPANY_NAME || name,
      contactPerson: name,
      mobile,
      email,
      city: columns.CITY || '',
      state: columns.STATE || '',
      country: columns.COUNTRY || 'India',
      pincode: columns.POSTAL_CODE || '',
      assignedTo,
      history: [{
        action: 'Lead Created',
        notes: `Auto-imported via Google Ads Lead Form webhook (Campaign: ${payload.campaign_name || payload.campaign_id || 'N/A'}, LeadID: ${leadId || 'N/A'})`,
        performedBy: null
      }]
    });

    await newLead.save();

    settings.googleAds.lastSyncedAt = new Date();
    await settings.save();

    // Google requires exactly this response shape to consider delivery successful
    return res.status(200).json({ google_key: googleKey });
  } catch (error) {
    console.error('Error receiving Google Ads webhook:', error);
    res.status(500).json({ google_key: req.query.q || req.body?.google_key || '' });
  }
};

export const getCallLogs = async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await Lead.findById(id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    // Find by leadId OR by clientNumber matching lead mobile
    const callLogs = await CallLog.find({
      companyId: req.user.companyId,
      $or: [
        { leadId: id },
        { clientNumber: lead.mobile?.replace(/\D/g, '').slice(-10) }
      ]
    }).sort({ createdAt: -1 }).limit(50);

    res.json({ success: true, callLogs });
  } catch (error) {
    console.error('Error fetching call logs:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// CLICK-TO-CALL (Acefone) — Agent ke phone pe call karo, phir customer se connect
// ═══════════════════════════════════════════════════════════════
export const clickToCall = async (req, res) => {
  try {
    const { customerNumber } = req.body;
    if (!customerNumber) {
      return res.status(400).json({ success: false, message: 'Customer number required' });
    }

    // Get API settings for this company
    const settings = await ApiSettings.findOne({ companyId: req.user.companyId });
    if (!settings?.ivr?.enabled || !settings.ivr.apiKey) {
      return res.status(400).json({ success: false, message: 'IVR API not configured. Please configure in API Settings.' });
    }

    // Get current user's IVR extension number
    const currentUser = await User.findById(req.user._id);
    const agentNumber = currentUser?.ivrNumber;
    if (!agentNumber) {
      return res.status(400).json({ success: false, message: `Your IVR extension number is not set. Please contact admin to set your IVR Number in your profile.` });
    }

    const callerID = settings.ivr.callerID || agentNumber;
    const apiKey   = settings.ivr.apiKey;

    // Acefone Click-to-Call API
    // Docs: https://www.acefone.in/api-documentation
    const payload = {
      api_key:        apiKey,
      caller_id:      callerID,
      agent_number:   agentNumber,
      customer_number: customerNumber.replace(/\D/g, ''),
    };

    console.log('[ClickToCall] Initiating call:', { agentNumber, customerNumber, callerID });

    let acefoneRes;
    try {
      const response = await fetch('https://api.acefone.in/click_to_call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      });
      acefoneRes = await response.json();
      console.log('[ClickToCall] Acefone response:', acefoneRes);
    } catch (fetchErr) {
      return res.status(502).json({ success: false, message: `Acefone API unreachable: ${fetchErr.message}` });
    }

    if (acefoneRes.status === 'success' || acefoneRes.success === true || acefoneRes.code === 200) {
      // Log the call attempt in CallLog
      const CallLog = (await import('../models/CallLog.js')).default;
      const lead = await Lead.findOne({ companyId: req.user.companyId, mobile: { $regex: customerNumber.replace(/\D/g, '').slice(-10) } });

      await CallLog.create({
        companyId: req.user.companyId,
        leadId: lead?._id || null,
        callId: acefoneRes.call_id || `ctc_${Date.now()}`,
        direction: 'outbound',
        status: 'initiated',
        service: 'ClickToCall',
        clientNumber: customerNumber.replace(/\D/g, '').slice(-10),
        agentNumber,
        agentName: currentUser?.fullName || '',
        callDate: new Date(),
        source: 'IVR'
      });

      return res.json({ success: true, message: 'Call initiated! Your phone will ring first, then connect to customer.', callId: acefoneRes.call_id });
    } else {
      return res.status(400).json({ success: false, message: acefoneRes.message || acefoneRes.error || 'Acefone call failed', raw: acefoneRes });
    }
  } catch (error) {
    console.error('[ClickToCall] Error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};
export const runBackgroundApiSync = async () => {
  console.log('🔄 [CRON] Starting background IndiaMART & IVR Lead Sync...');
  try {
    // 1. IndiaMART Sync
    const indiamartSettings = await ApiSettings.find({ 'indiamart.enabled': true });
    console.log(`[CRON] Found ${indiamartSettings.length} companies with IndiaMART enabled.`);
    
    for (const settings of indiamartSettings) {
      try {
        const { companyId } = settings;
        
        let activeAccounts = [];
        if (settings.indiamart.accounts && settings.indiamart.accounts.length > 0) {
          activeAccounts = settings.indiamart.accounts.filter(acc => acc.sellerMobile && acc.authKey);
        } else if (settings.indiamart.sellerMobile && settings.indiamart.authKey) {
          activeAccounts = [{
            apiName: 'Primary Account',
            sellerMobile: settings.indiamart.sellerMobile,
            authKey: settings.indiamart.authKey,
            _id: null
          }];
        }

        if (activeAccounts.length === 0) continue;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 3);
        const fmt = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');

        let companyImported = 0;

        for (const account of activeAccounts) {
          try {
            const { sellerMobile, authKey, apiName } = account;
            const url = `https://mapi.indiamart.com/wservce/enquiry/listing/v2/?GLUSR_MOBILE=${sellerMobile}&GLUSR_MOBILE_KEY=${authKey}&START_TIME=${fmt(startDate)}&END_TIME=${fmt(new Date())}&LIMIT=50&FLAG=1`;

            const response = await fetch(url);
            const data = await response.json();

            if (data?.RESPONSE?.length) {
              for (const lead of data.RESPONSE) {
                const queryId = (lead.QUERY_ID || '').trim();
                if (!queryId) continue;

                // Check duplicate using fast indexed field first
                let exists = await Lead.findOne({ companyId, indiamartQueryId: queryId });
                if (!exists) {
                  // Fallback legacy check to avoid duplicates for older imported leads
                  exists = await Lead.findOne({ 
                    companyId, 
                    describeRequirements: { $regex: `QueryID:${queryId}`, $options: 'i' } 
                  });
                  // Auto-migrate legacy lead to populate indiamartQueryId
                  if (exists) {
                    exists.indiamartQueryId = queryId;
                    await exists.save();
                  }
                }
                if (exists) continue;

                // 🎯 CRUNCHER FLOW: IndiaMART leads always UNASSIGNED — Cruncher will assign manually
                const assignedTo = null;

                const count = await Lead.countDocuments({ companyId });
                const leadCode = `LD-${String(count + 1).padStart(4, '0')}`;
                const senderName = lead.SENDER_NAME || lead.SUBJECT || 'IndiaMART Lead';
                const senderMobile = lead.SENDER_MOBILE || lead.SENDER_MOBILE_ALT || '0000000000';
                const senderEmail = lead.SENDER_EMAIL || `indiamartlead_${queryId}@noemail.com`;

                const newLead = new Lead({
                  leadCode,
                  companyId,
                  source: 'IndiaMart',
                  status: 'New',
                  stage: 'N/A',
                  productRequired: lead.PRODUCT_NAME || lead.SUBJECT || 'Unknown',
                  describeRequirements: `${lead.QUERY_MESSAGE || ''} [QueryID:${queryId}] (Account: ${apiName || 'Default'})`,
                  indiamartQueryId: queryId,
                  companyName: senderName,
                  contactPerson: senderName,
                  mobile: senderMobile,
                  email: senderEmail,
                  address: lead.SENDER_ADDRESS || '',
                  assignedTo,
                  leadDate: lead.QUERY_TIME ? new Date(lead.QUERY_TIME) : new Date(),
                  history: [{
                    action: 'Lead Created',
                    notes: `Auto-imported via background sync from account "${apiName || 'Default'}" (QueryID: ${queryId}) — Pending Cruncher assignment`,
                    performedBy: null
                  }]
                });
                await newLead.save();
                companyImported++;
              }

              // Update lastSyncedAt for this specific account
              if (account._id && settings.indiamart.accounts) {
                const accDoc = settings.indiamart.accounts.id(account._id);
                if (accDoc) accDoc.lastSyncedAt = new Date();
              }
            }
          } catch (accErr) {
            console.error(`[CRON] IndiaMART sync error for account ${account.apiName || account.sellerMobile} in company ${companyId}:`, accErr.message);
          }
        }

        // Save settings with updated lastSyncedAt times for accounts
        settings.indiamart.lastSyncedAt = new Date();
        await settings.save();

        if (companyImported > 0) {
          console.log(`[CRON] IndiaMART sync completed for company ${companyId}. Imported: ${companyImported}`);
        }
      } catch (err) {
        console.error(`[CRON] IndiaMART sync error for settings ID ${settings._id}:`, err.message);
      }
    }

    // 2. IVR Sync (Acefone)
    const ivrSettings = await ApiSettings.find({ 'ivr.enabled': true });
    console.log(`[CRON] Found ${ivrSettings.length} companies with IVR enabled.`);

    for (const settings of ivrSettings) {
      try {
        const { companyId } = settings;
        const { apiKey, assignmentRule, assignedUserIds, lastAssignedIndex } = settings.ivr;
        if (!apiKey) continue;

        const response = await fetch(`https://api.acefone.in/get_leads?api_key=${encodeURIComponent(apiKey)}`);
        const data = await response.json();

        const leads = data?.data || (Array.isArray(data) ? data : []);
        if (leads.length) {
          let imported = 0;
          let assignIdx = lastAssignedIndex || 0;
          const users = assignedUserIds || [];

          for (const ivrLead of leads) {
            const callerNumber = (ivrLead.caller_number || '').trim();
            if (!callerNumber) continue;

            const exists = await Lead.findOne({ companyId, mobile: callerNumber, source: 'IVR' });
            if (exists) continue;

            let assignedTo = null;
            if (users.length > 0) {
              if (assignmentRule === 1) {
                assignedTo = users[Math.floor(Math.random() * users.length)];
              } else if (assignmentRule === 2) {
                assignedTo = users[assignIdx % users.length];
                assignIdx++;
              }
            }

            const count = await Lead.countDocuments({ companyId });
            const leadCode = `LD-${String(count + 1).padStart(4, '0')}`;

            const newLead = new Lead({
              leadCode,
              companyId,
              source: 'IVR',
              status: 'New',
              stage: 'N/A',
              productRequired: ivrLead.ivr_option || ivrLead.subject || 'IVR Call Enquiry',
              describeRequirements: ivrLead.message || `Inbound IVR call from ${callerNumber}`,
              companyName: ivrLead.company_name || ivrLead.caller_name || 'IVR Caller',
              contactPerson: ivrLead.caller_name || `Caller_${callerNumber.slice(-4)}`,
              mobile: callerNumber,
              email: ivrLead.email || `ivr_${callerNumber}@noemail.com`,
              address: ivrLead.address || '',
              assignedTo,
              history: [{
                action: 'Lead Created',
                notes: `Auto-imported via scheduled background sync (Caller: ${callerNumber})`,
                performedBy: null
              }]
            });
            await newLead.save();
            imported++;
          }

          await ApiSettings.findByIdAndUpdate(settings._id, {
            'ivr.lastAssignedIndex': assignIdx,
            'ivr.lastSyncedAt': new Date()
          });
          console.log(`[CRON] IVR sync completed for company ${companyId}. Imported: ${imported}`);
        }
      } catch (err) {
        console.error(`[CRON] IVR sync error for settings ID ${settings._id}:`, err.message);
      }
    }
  } catch (globalErr) {
    console.error('[CRON] Lead Sync job failed:', globalErr);
  }
};
