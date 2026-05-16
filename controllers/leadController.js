import Lead from '../models/Lead.js';
import User from '../models/User.js';
import Customer from '../models/Customer.js';
import mongoose from 'mongoose';

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
      nextFollowUpDateTo
    } = req.query;

    const query = { companyId: req.user.companyId };

    // Basic filters
    if (status && status !== 'all' && status !== 'All Active Leads') {
      if (status === "Today's Follow-up") {
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
    if (assignedTo) query.assignedTo = assignedTo;
    
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
      query.$or = [
        { companyName: { $regex: search, $options: 'i' } },
        { contactPerson: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { leadCode: { $regex: search, $options: 'i' } },
        { productRequired: { $regex: search, $options: 'i' } }
      ];
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

    const leads = await Lead.find(query)
      .populate('assignedTo', 'fullName username')
      .populate('observer', 'fullName username')
      .sort(sortOptions)
      .limit(parseInt(limit));

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

// Update lead
export const updateLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    const updates = req.body;
    
    // Log history if status or stage changed
    if (updates.status && updates.status !== lead.status) {
      lead.history.push({
        action: 'Status Updated',
        notes: `Status changed from ${lead.status} to ${updates.status}`,
        performedBy: req.user._id
      });
    }

    Object.assign(lead, updates);
    await lead.save();

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
    const users = await User.find({ 
      companyId: req.user.companyId,
      role: { $in: ['Sales', 'Sales Employee', 'Sales Head', 'Manager', 'HR-Admin'] },
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
    console.log(`[Deal Won] Starting conversion for Lead: ${req.params.id}`);
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    if (lead.status === 'Won') {
      return res.status(400).json({ success: false, message: 'Lead already marked as won' });
    }

    // Ensure we have ObjectId strings, not objects (in case they were populated)
    const companyId = (lead.companyId?._id || lead.companyId || req.user.companyId)?.toString();
    const salesPersonId = (lead.assignedTo?._id || lead.assignedTo || req.user._id)?.toString();
    const unit = lead.unit || req.user.unit; // Use unit from lead if available, else from creator

    console.log(`[Deal Won] Using CompanyId: ${companyId}, SalesPersonId: ${salesPersonId}, Unit: ${unit}`);

    // 1. Check/Create Customer
    let customer = await Customer.findOne({ 
      companyId: companyId,
      $or: [
        { email: lead.email },
        { mobile: lead.mobile }
      ]
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
        active: 'Yes'
      });
      await customer.save();
      console.log(`[Deal Won] Customer created: ${customer._id}`);
    } else {
      console.log(`[Deal Won] Existing customer found: ${customer._id}`);
    }

    // 2. Create Order
    const { Item } = await import('../models/Inventory.js');
    
    // Improved search for product - check both companyId and store fields
    let item = null;
    if (lead.productRequired) {
      const searchStr = lead.productRequired.trim();
      const escapedProduct = searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      item = await Item.findOne({ 
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

    const Order = (await import('../models/Order.js')).default;
    
    let orderCode;
    let isUnique = false;
    let attempts = 0;
    
    while (!isUnique && attempts < 10) {
      const globalOrderCount = await Order.countDocuments();
      orderCode = `ORD-${String(globalOrderCount + 1 + attempts).padStart(4, '0')}`;
      const existingOrder = await Order.findOne({ orderCode });
      if (!existingOrder) {
        isUnique = true;
      } else {
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
    } else {
      console.log(`[Deal Won] No specific item found for "${lead.productRequired}", searching for any item for company: ${companyId}`);
      const genericItem = await Item.findOne({ 
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
      } else {
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
      status: 'pending',
      notes: `Order generated from Lead ${lead.leadCode}`,
      quotation: lead.quotation // Transfer quotation from lead to order
    });

    await newOrder.save();
    console.log(`[Deal Won] Order created: ${newOrder.orderCode} (${newOrder._id})`);

    // 3. Update Lead Status
    lead.status = 'Won';
    lead.history.push({
      action: 'Deal Won',
      notes: `Lead converted to customer and order created (${orderCode})`,
      performedBy: req.user._id
    });

    await lead.save();
    console.log(`[Deal Won] Lead status updated to Won`);

    res.json({ 
      success: true, 
      message: 'Lead successfully converted to customer and order created', 
      customer, 
      order: newOrder 
    });

  } catch (error) {
    console.error('[Deal Won] Error marking lead as won:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};
