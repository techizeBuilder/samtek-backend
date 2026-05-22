import QCJob from '../models/QCJob.js';
import { Item } from '../models/Inventory.js';
import ProductionOrder from '../models/ProductionOrder.js';


const today = () => new Date().toISOString().split('T')[0];

async function generateQCJobId() {
  const year = new Date().getFullYear();
  const lastJob = await QCJob.findOne({ 
    qcJobId: new RegExp(`^QC-${year}-`) 
  }).sort({ qcJobId: -1 }).lean();

  let nextNumber = 1;
  if (lastJob && lastJob.qcJobId) {
    const parts = lastJob.qcJobId.split('-');
    if (parts.length === 3) {
      const lastNumber = parseInt(parts[2]);
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }
  }

  return `QC-${year}-${String(nextNumber).padStart(4, '0')}`;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const getDashboard = async (req, res) => {
  try {
    const cid = req.user.companyId;
    const todayStr = today();

    const [total, pending, inProgress, approved, rejected, todayCount] = await Promise.all([
      QCJob.countDocuments({ company: cid }),
      QCJob.countDocuments({ company: cid, status: 'Pending' }),
      QCJob.countDocuments({ company: cid, status: 'In Progress' }),
      QCJob.countDocuments({ company: cid, status: 'Approved' }),
      QCJob.countDocuments({ company: cid, status: 'Rejected' }),
      QCJob.countDocuments({ company: cid, receivedDate: todayStr }),
    ]);

    // Source-wise breakdown
    const sourceBreakdown = await QCJob.aggregate([
      { $match: { company: cid } },
      { $group: { _id: '$source', count: { $sum: 1 } } },
    ]);

    // Category breakdown
    const categoryBreakdown = await QCJob.aggregate([
      { $match: { company: cid } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);

    // Top fail reasons (from rejected jobs)
    const failReasons = await QCJob.aggregate([
      { $match: { company: cid, status: 'Rejected', failReason: { $ne: '' } } },
      { $group: { _id: '$failReason', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    // Recent 5 jobs
    const recentJobs = await QCJob.find({ company: cid })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    res.json({
      success: true,
      data: {
        summary: { total, pending, inProgress, approved, rejected, todayCount },
        sourceBreakdown,
        categoryBreakdown,
        failReasons,
        recentJobs,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── QC Jobs CRUD ──────────────────────────────────────────────────────────────
export const getQCJobs = async (req, res) => {
  try {
    const { status, source, category } = req.query;
    const filter = { company: req.user.companyId };
    if (status) filter.status = status;
    if (source) filter.source = source;
    if (category) filter.category = category;
    const jobs = await QCJob.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: jobs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getQCJob = async (req, res) => {
  try {
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId }).lean();
    if (!job) return res.status(404).json({ success: false, message: 'QC job not found' });
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createQCJob = async (req, res) => {
  try {
    const {
      source, sourceRefId, sourceDepartment, sentBy,
      itemName, itemCode, category, quantity, unit, receivedDate,
      checklist, notes,
    } = req.body;

    if (!source || !itemName || !category || !receivedDate) {
      return res.status(400).json({ success: false, message: 'source, itemName, category, receivedDate are required' });
    }

    const qcJobId = await generateQCJobId();

    const job = await QCJob.create({
      qcJobId,
      source, sourceRefId, sourceDepartment, sentBy,
      itemName, itemCode, category,
      quantity: quantity || 1,
      unit: unit || 'pcs',
      receivedDate,
      checklist: (checklist || []).map(c => ({
        parameter: c.parameter,
        standardValue: c.standardValue || '',
        actualValue: '',
        status: 'Pending',
        remarks: '',
      })),
      notes: notes || '',
      company: req.user.companyId,
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateQCJob = async (req, res) => {
  try {
    const job = await QCJob.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { ...req.body },
      { new: true }
    );
    if (!job) return res.status(404).json({ success: false, message: 'QC job not found' });
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Inspection Workflow ───────────────────────────────────────────────────────
export const startInspection = async (req, res) => {
  try {
    const { inspector } = req.body;
    const job = await QCJob.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, status: 'Pending' },
      { status: 'In Progress', inspector: inspector || req.user.fullName || '', inspectionStartDate: today() },
      { new: true }
    );
    if (!job) return res.status(404).json({ success: false, message: 'Job not found or not in Pending state' });
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateChecklistItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { actualValue, status, remarks } = req.body;

    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const item = job.checklist.id(itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Checklist item not found' });

    if (actualValue !== undefined) item.actualValue = actualValue;
    if (status !== undefined) item.status = status;
    if (remarks !== undefined) item.remarks = remarks;

    await job.save();
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const submitDecision = async (req, res) => {
  try {
    const { decision, failReason, inspectorRemarks } = req.body;
    if (!decision || !['Pass', 'Fail'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'decision must be Pass or Fail' });
    }
    if (decision === 'Fail' && !failReason) {
      return res.status(400).json({ success: false, message: 'failReason is required when decision is Fail' });
    }

    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId, status: 'In Progress' });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found or not In Progress' });

    job.decision = decision;
    job.status = decision === 'Pass' ? 'Approved' : 'Rejected';
    job.inspectionEndDate = today();
    job.failReason = failReason || '';
    job.inspectorRemarks = inspectorRemarks || '';

    if (decision === 'Pass') {
      job.transferredToStore = true;

      // 1. Add to Item Inventory
      try {
        let inventoryItem = null;
        
        // Attempt 1: Search by ObjectId
        if (job.itemCode && /^[0-9a-fA-F]{24}$/.test(job.itemCode)) {
          inventoryItem = await Item.findById(job.itemCode);
        }
        
        // Attempt 2: Search by Code and Store
        if (!inventoryItem && job.itemCode) {
          inventoryItem = await Item.findOne({
            code: job.itemCode,
            store: job.company.toString()
          });
        }
        
        // Attempt 3: Search by Name and Store
        if (!inventoryItem && job.itemName) {
          inventoryItem = await Item.findOne({
            name: job.itemName,
            store: job.company.toString()
          });
        }
        
        if (inventoryItem) {
          const prevQty = inventoryItem.qty || 0;
          inventoryItem.qty = prevQty + (job.quantity || 1);
          await inventoryItem.save();
          console.log(`✅ [QC Approval] Inventory updated for item ${inventoryItem.name}. Previous Qty: ${prevQty}, New Qty: ${inventoryItem.qty}`);
        } else {
          // If item does not exist, let's create a new inventory item!
          const newCode = job.itemCode || `ITEM-${Date.now()}`;
          inventoryItem = await Item.create({
            name: job.itemName,
            code: newCode,
            category: job.category || 'Raw Material',
            qty: job.quantity || 1,
            unit: job.unit || 'pcs',
            store: job.company.toString(),
            companyId: job.company,
            type: job.category === 'Finished Good' ? 'Product' : 'Material',
            stdCost: 0,
            purchaseCost: 0,
            salePrice: 0
          });
          console.log(`✅ [QC Approval] Created new inventory item for ${job.itemName} with code ${newCode}`);
        }
      } catch (invError) {
        console.error('❌ Error updating inventory upon QC Approval:', invError);
      }

      // 2. Link QC Job / Purchase Request back to Sale / Order and update statuses if applicable
      try {
        const PurchaseRequest = (await import('../models/PurchaseRequest.js')).default;
        const pr = await PurchaseRequest.findOne({
          $or: [
            { requestId: job.sourceRefId },
            { requestId: job.itemCode }
          ]
        }).populate('storeOrderId');

        if (pr && pr.storeOrderId) {
          console.log(`[QC Approval] Found related storeOrderId: ${pr.storeOrderId._id || pr.storeOrderId} for Purchase Request ${pr.requestId}`);
          
          const Sale = (await import('../models/Sale.js')).default;
          const sale = await Sale.findOne({
            $or: [
              { order: pr.storeOrderId._id || pr.storeOrderId },
              { _id: pr.storeOrderId._id || pr.storeOrderId }
            ]
          });

          if (sale) {
            console.log(`[QC Approval] Auto-updating Sale ${sale._id} status to Available since QC approved.`);
            sale.isAvailableInInventory = 'Available';
            await sale.save();
          }
        }
      } catch (workflowError) {
        console.error('❌ Error in linking purchase request workflow on QC Approval:', workflowError);
      }
    }
    
    if (decision === 'Fail') {
      job.returnedToSource = true;
      
      if (job.source === 'Purchase') {
        // Auto-create purchase return for rejected purchase items
        try {
          const { createQCRejectedPurchaseReturn } = await import('./purchaseInvoiceController.js');
          await createQCRejectedPurchaseReturn(job, req.user);
          console.log(`✅ [QC Rejection] Created purchase return for rejected purchase item: ${job.itemName}`);
        } catch (returnError) {
          console.error('❌ Error creating purchase return for rejected purchase item:', returnError);
        }
      } else {
        // Auto-create production order for rejected production/store items
        try {
          await createRejectedProductionOrder(job, req.user);
          console.log(`✅ [QC Rejection] Created production order for rejected item: ${job.itemName}`);
        } catch (prodError) {
          console.error('❌ Error creating production order for rejected item:', prodError);
        }
      }
    }

    await job.save();
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Helper function to create production order for rejected QC items
async function createRejectedProductionOrder(qcJob, user) {
  try {
    // Generate unique order ID
    const year = new Date().getFullYear();
    const lastOrder = await ProductionOrder.findOne({ 
      orderId: new RegExp(`^REJ-${year}-`) 
    }).sort({ orderId: -1 }).lean();

    let nextNumber = 1;
    if (lastOrder && lastOrder.orderId) {
      const parts = lastOrder.orderId.split('-');
      if (parts.length === 3) {
        const lastNumber = parseInt(parts[2]);
        if (!isNaN(lastNumber)) {
          nextNumber = lastNumber + 1;
        }
      }
    }

    const rejectedOrderId = `REJ-${year}-${String(nextNumber).padStart(4, '0')}`;

    // Create production order for rejected item
    const productionOrder = await ProductionOrder.create({
      orderId: rejectedOrderId,
      machineCode: qcJob.itemCode || `REJ-${qcJob.qcJobId}`,
      machineName: qcJob.itemName,
      priority: 'Urgent', // Rejected items get urgent priority
      source: 'QC_Rejected',
      rejectionDetails: {
        originalOrderId: qcJob.sourceRefId,
        rejectionReason: qcJob.failReason,
        rejectedDate: today(),
        qcJobId: qcJob.qcJobId
      },
      status: 'Pending',
      receivedDate: today(),
      deliveryDate: getDeliveryDate(7), // 7 days from today for urgent rebuild
      bomVerified: false,
      designVerified: false,
      rdRequestRaised: false,
      materialIssued: false,
      company: qcJob.company,
      createdBy: user._id
    });

    return productionOrder;
  } catch (error) {
    console.error('Error creating rejected production order:', error);
    throw error;
  }
}

// Helper function to get delivery date
function getDeliveryDate(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split('T')[0];
}


export const addChecklistItem = async (req, res) => {
  try {
    const { parameter, standardValue } = req.body;
    if (!parameter) return res.status(400).json({ success: false, message: 'parameter is required' });
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    job.checklist.push({ parameter, standardValue: standardValue || '', actualValue: '', status: 'Pending', remarks: '' });
    await job.save();
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const removeChecklistItem = async (req, res) => {
  try {
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    job.checklist = job.checklist.filter(c => String(c._id) !== req.params.itemId);
    await job.save();
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
