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
      paymentCheckRequested
    } = req.query;

    const query = { companyId: req.user.companyId };
    const andConditions = [];

    if (paymentCheckRequested === 'true') {
      query.paymentCheckStatus = { $in: ['Pending', 'Paid', 'Partially Paid', 'Rejected'] };
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
    if (sortBy === 'date' || sortBy === 'createdAt') {
      sortOptions.createdAt = order === 'asc' ? 1 : -1;
    } else if (sortBy === 'value') {
      sortOptions.dealValue = order === 'asc' ? 1 : -1;
    } else {
      sortOptions[sortBy] = order === 'asc' ? 1 : -1;
    }

    const leadsDocs = await Lead.find(query)
      .select('-quotation')
      .populate('assignedTo', 'fullName username')
      .populate('observer', 'fullName username')
      .populate('history.performedBy', 'fullName username')
      .sort(sortOptions)
      .limit(parseInt(limit));

    // Efficiently check which leads have a quotation
    const leadIds = leadsDocs.map(l => l._id);
    const quotes = await Lead.find({ _id: { $in: leadIds }, quotation: { $exists: true, $ne: "" } }).select('_id');
    const quoteSet = new Set(quotes.map(q => q._id.toString()));

    const leads = leadsDocs.map(l => {
      const doc = l.toObject();
      doc.hasQuotation = quoteSet.has(doc._id.toString());
      return doc;
    });

    res.json({ success: true, count: leads.length, leads });
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
        advancePayment: lead.advancedPaymentAmount || 0
      });
      await customer.save();
    } else {
      if (lead.advancedPaymentAmount > 0) {
        customer.advancePayment = (customer.advancePayment || 0) + lead.advancedPaymentAmount;
        await customer.save();
      }
    }

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
      .populate('website.assignedUserIds', 'fullName username');

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
    const { indiamart, ivr, website } = req.body;
    // Super Admin can save settings for any company via ?companyId=xxx
    const targetCompanyId = (req.user.role === 'Super Admin' && req.query.companyId)
      ? req.query.companyId
      : req.user.companyId;

    const settings = await ApiSettings.findOneAndUpdate(
      { companyId: targetCompanyId },
      { $set: { indiamart, ivr, website } },
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

    if (!settings?.indiamart?.enabled || !settings.indiamart.sellerMobile) {
      return res.status(400).json({ success: false, message: 'IndiaMART API not configured or disabled. Please configure in API Settings.' });
    }

    const { sellerMobile, assignmentRule, assignedUserIds, lastAssignedIndex } = settings.indiamart;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 3);
    const fmt = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');

    const url = `https://mapi.indiamart.com/wservce/enquiry/listing/v2/?GLUSR_MOBILE=${sellerMobile}&START_TIME=${fmt(startDate)}&END_TIME=${fmt(new Date())}&LIMIT=50&FLAG=1`;

    let data;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const rawText = await response.text();
      console.log(`[IndiaMART] HTTP ${response.status} — Raw response: ${rawText.substring(0, 500)}`);
      try {
        data = JSON.parse(rawText);
      } catch {
        return res.status(502).json({ success: false, message: `IndiaMART API returned non-JSON response: ${rawText.substring(0, 200)}` });
      }
    } catch (fetchErr) {
      console.error('[IndiaMART] Fetch error:', fetchErr.message, fetchErr.cause || '');
      return res.status(502).json({ success: false, message: `Failed to connect to IndiaMART API: ${fetchErr.message}` });
    }

    if (!data?.RESPONSE?.length) {
      return res.json({ success: true, message: 'No new leads found from IndiaMART', imported: 0 });
    }

    let imported = 0;
    let skipped = 0;

    for (const lead of data.RESPONSE) {
      const queryId = (lead.QUERY_ID || '').trim();
      if (!queryId) continue;

      // Check duplicate by queryId in description
      const exists = await Lead.findOne({ companyId: req.user.companyId, describeRequirements: { $regex: `QueryID:${queryId}`, $options: 'i' } });
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
        describeRequirements: `${lead.QUERY_MESSAGE || ''} [QueryID:${queryId}]`,
        companyName: senderName,
        contactPerson: senderName,
        mobile: senderMobile,
        email: senderEmail,
        address: lead.SENDER_ADDRESS || '',
        assignedTo,
        leadDate: lead.QUERY_TIME ? new Date(lead.QUERY_TIME) : new Date(),
        history: [{
          action: 'Lead Created',
          notes: `Auto-imported from IndiaMART (QueryID: ${queryId}) — Pending Cruncher assignment`,
          performedBy: req.user._id
        }]
      });

      await newLead.save();
      imported++;
    }

    // Update sync time (no more lastAssignedIndex needed for IndiaMART)
    await ApiSettings.findOneAndUpdate(
      { companyId: req.user.companyId },
      { 'indiamart.lastSyncedAt': new Date() }
    );

    res.json({ success: true, message: `IndiaMART sync complete. Imported: ${imported}, Skipped (duplicates): ${skipped}`, imported, skipped });
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

    // Duplicate check
    const exists = await Lead.findOne({
      companyId: settings.companyId,
      $or: [{ mobile }, { email }]
    });
    if (exists) {
      return res.json({ success: true, message: 'Lead already exists', leadId: exists._id });
    }

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
        const { sellerMobile, assignmentRule, assignedUserIds, lastAssignedIndex } = settings.indiamart;
        if (!sellerMobile) continue;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 3);
        const fmt = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
        const url = `https://mapi.indiamart.com/wservce/enquiry/listing/v2/?GLUSR_MOBILE=${sellerMobile}&START_TIME=${fmt(startDate)}&END_TIME=${fmt(new Date())}&LIMIT=50&FLAG=1`;

        const response = await fetch(url);
        const data = await response.json();

        if (data?.RESPONSE?.length) {
          let imported = 0;
          let assignIdx = lastAssignedIndex || 0;
          const users = assignedUserIds || [];

          for (const lead of data.RESPONSE) {
            const queryId = (lead.QUERY_ID || '').trim();
            if (!queryId) continue;

            const exists = await Lead.findOne({ companyId, describeRequirements: { $regex: `QueryID:${queryId}`, $options: 'i' } });
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
              describeRequirements: `${lead.QUERY_MESSAGE || ''} [QueryID:${queryId}]`,
              companyName: senderName,
              contactPerson: senderName,
              mobile: senderMobile,
              email: senderEmail,
              address: lead.SENDER_ADDRESS || '',
              assignedTo,
              leadDate: lead.QUERY_TIME ? new Date(lead.QUERY_TIME) : new Date(),
              history: [{
                action: 'Lead Created',
                notes: `Auto-imported via background sync (QueryID: ${queryId}) — Pending Cruncher assignment`,
                performedBy: null
              }]
            });
            await newLead.save();
            imported++;
          }

          await ApiSettings.findByIdAndUpdate(settings._id, {
            'indiamart.lastSyncedAt': new Date()
          });
          console.log(`[CRON] IndiaMART sync completed for company ${companyId}. Imported: ${imported}`);
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
