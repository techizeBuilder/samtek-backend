import Lead from '../models/Lead.js';
import User from '../models/User.js';

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
      role: { $in: ['Sales', 'Manager', 'HR-Admin'] },
      isActive: true
    }).select('fullName username role employeeId');
    
    res.json({ success: true, users });
  } catch (error) {
    console.error('Error fetching assignable users:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};
