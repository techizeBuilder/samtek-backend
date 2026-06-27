import QCJob from '../models/QCJob.js';
import { Item } from '../models/Inventory.js';
import ProductionOrder from '../models/ProductionOrder.js';
import Sale from '../models/Sale.js';
import notificationService from '../services/notificationService.js';


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

    // 🔔 Notify QC team about new job
    try {
      await notificationService.triggerQCNotification({
        action: 'qc_job_created',
        data: { qcJobId, itemName, jobId: job._id },
        targetCompanyId: req.user.companyId,
      });
    } catch (e) { console.error('QC job created notification error:', e); }

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
    if (!inspector || !inspector.trim()) {
      return res.status(400).json({ success: false, message: 'Inspector name is required to start inspection' });
    }
    const job = await QCJob.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, status: 'Pending' },
      { status: 'In Progress', inspector: inspector.trim(), inspectionStartDate: today() },
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

    // Enforce: all checklist items must be inspected before a decision can be submitted
    if (job.checklist && job.checklist.length > 0) {
      const pendingItems = job.checklist.filter(c => c.status === 'Pending');
      if (pendingItems.length > 0) {
        return res.status(400).json({
          success: false,
          message: `${pendingItems.length} checklist item${pendingItems.length > 1 ? 's' : ''} still pending. Complete all checklist items before submitting a decision.`
        });
      }
    }

    job.decision = decision;
    job.status = decision === 'Pass' ? 'Approved' : 'Rejected';
    job.inspectionEndDate = today();
    job.failReason = failReason || '';
    job.inspectorRemarks = inspectorRemarks || '';

    if (decision === 'Pass') {
      job.transferredToStore = true;

      // 1. Update Item Inventory
      // Rules:
      // - 'Purchase' source  → item received from vendor → ADD to inventory
      // - 'Stock' source     → company produced for own stock → ADD to inventory
      // - 'Store' source     → item was from store order (qty already deducted) → dispatch, no add
      // - 'QC_Rejected'      → item re-made for original order → dispatch, no add
      
      let shouldAddToInventory = false;
      if (job.source === 'Stock') {
        shouldAddToInventory = true;
      } else if (job.source === 'Purchase') {
        const MACHINE_CATS = ['purchase machine', 'manufacturing machine'];
        const catLower = (job.category || '').toLowerCase().trim();

        if (MACHINE_CATS.includes(catLower)) {
          // Category stored correctly — machine, do not add to inventory
          shouldAddToInventory = false;
        } else {
          // Category may be mis-stored — double-check against actual inventory item
          let actualIsMachine = false;
          try {
            let chkItem = null;
            if (job.itemCode && /^[0-9a-fA-F]{24}$/.test(job.itemCode)) {
              chkItem = await Item.findById(job.itemCode).lean();
            }
            if (!chkItem && job.itemCode) {
              chkItem = await Item.findOne({ code: job.itemCode, store: job.company.toString() }).lean();
            }
            if (!chkItem && job.itemName) {
              chkItem = await Item.findOne({ name: job.itemName, store: job.company.toString() }).lean();
            }
            if (chkItem && MACHINE_CATS.includes((chkItem.category || '').toLowerCase().trim())) {
              actualIsMachine = true;
              // Also fix the stored category on the QC job so future lookups are correct
              job.category = chkItem.category;
              console.log(`[QC Approval] Fixed QC job category from '${catLower}' → '${chkItem.category}' for item '${job.itemName}'`);
            }
          } catch (chkErr) {
            console.error('[QC Approval] Error verifying item category:', chkErr);
          }

          if (actualIsMachine) {
            shouldAddToInventory = false; // It's a machine — goes to dispatch, no qty increment
          } else {
            shouldAddToInventory = true;  // Genuine raw material / spare — add to inventory
          }
        }
      }

      if (shouldAddToInventory) {
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
            console.log(`✅ [QC Approval - ${job.source}] Inventory updated for ${inventoryItem.name}. Prev: ${prevQty}, New: ${inventoryItem.qty}`);
          } else {
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
            console.log(`✅ [QC Approval - ${job.source}] Created new inventory item: ${job.itemName}`);
          }
        } catch (invError) {
          console.error('❌ Error updating inventory upon QC Approval:', invError);
        }
      } else {
        console.log(`[QC Approval - ${job.source}] No inventory add — item goes to dispatch/packing.`);
      }

      // 2. Link QC Job back to Sale / Order and update statuses
      //
      // Rules per source:
      // - 'Store'/'Production' → set storeQCStatus='Approved from QC' (goes to dispatch)
      // - 'QC_Rejected'        → same as Store — find linked Sale via ProductionOrder notes, mark available for dispatch
      // - 'Stock'              → inventory already updated above; no sale/dispatch update
      // - 'Purchase'           → set storeQCStatus='Approved from QC' (for machines) or 'Purchase Completed' (others)

      if (job.source === 'Store' || job.source === 'Production') {
        try {
          // Strategy 1: Use direct saleId reference (most reliable — set when QC job created)
          let saleByRef = null;
          if (job.saleId) {
            saleByRef = await Sale.findById(job.saleId);
          }

          // Strategy 2: Fall back to sourceRefId matching
          if (!saleByRef && job.sourceRefId) {
            saleByRef = await Sale.findOne({
              $or: [
                { invoiceNumber: job.sourceRefId },
                { _id: /^[0-9a-fA-F]{24}$/.test(job.sourceRefId) ? job.sourceRefId : null }
              ]
            });
          }

          // Strategy 3: Lookup via ProductionOrder (if Production source)
          if (!saleByRef && job.source === 'Production' && job.sourceRefId) {
            try {
              const prodOrder = await ProductionOrder.findOne({
                orderId: job.sourceRefId,
                company: job.company
              }).lean();
              if (prodOrder && prodOrder.saleId) {
                saleByRef = await Sale.findById(prodOrder.saleId);
              }
            } catch (err) {
              console.error('Error looking up production order for sale ref:', err);
            }
          }

          if (saleByRef) {
            saleByRef.storeQCStatus = 'Approved from QC';
            await saleByRef.save();
            console.log(`✅ [QC Approval - ${job.source}] storeQCStatus='Approved from QC' for Sale ${saleByRef._id}`);
          } else {
            console.warn(`⚠️ [QC Approval - ${job.source}] Could not find linked Sale for QC Job ${job.qcJobId}. saleId: ${job.saleId}, sourceRefId: ${job.sourceRefId}`);
          }
        } catch (e) { console.error(`❌ Error updating Sale on ${job.source} QC approval:`, e); }

      } else if (job.source === 'QC_Rejected') {
        // Re-made item for original order — find linked Sale via ProductionOrder notes and trigger dispatch
        try {
          const linkedProdOrder = await ProductionOrder.findOne({
            $or: [
              { orderId: job.sourceRefId },
              { _id: job.sourceRefId && /^[0-9a-fA-F]{24}$/.test(job.sourceRefId) ? job.sourceRefId : null }
            ],
            company: job.company
          }).lean();

          if (linkedProdOrder && linkedProdOrder.notes) {
            const notesRefMatch = linkedProdOrder.notes.match(/Ref:\s*(\S+)/);
            const saleRef = notesRefMatch ? notesRefMatch[1] : null;
            if (saleRef) {
              const linkedSale = await Sale.findOne({
                $or: [
                  { invoiceNumber: saleRef },
                  { _id: /^[0-9a-fA-F]{24}$/.test(saleRef) ? saleRef : null }
                ]
              });
              if (linkedSale) {
                linkedSale.isAvailableInInventory = 'Available';
                linkedSale.storeQCStatus = 'Approved from QC';
                await linkedSale.save();
                console.log(`[QC Approval - QC_Rejected] Sale ${linkedSale._id} → Available + Approved from QC. Ready for dispatch.`);
              }
            }
          }
        } catch (e) { console.error('❌ Error updating Sale on QC_Rejected approval:', e); }

      } else if (job.source === 'Stock') {
        // Stock production — qty added to inventory above, no sale/dispatch update needed
        console.log(`[QC Approval - Stock] Inventory updated. No sale/dispatch update.`);

      } else if (job.source === 'Purchase') {
        // Purchase source — update storeQCStatus on linked sale
        try {
          const PurchaseRequest = (await import('../models/PurchaseRequest.js')).default;

          // Strategy 1: Use direct purchaseRequestId reference (most reliable)
          let pr = null;
          if (job.purchaseRequestId) {
            pr = await PurchaseRequest.findById(job.purchaseRequestId);
          }

          // Strategy 2: Fall back to searching by requestId / itemCode
          if (!pr) {
            pr = await PurchaseRequest.findOne({
              $or: [
                { requestId: job.sourceRefId },
                { requestId: job.itemCode },
                { itemId: job.sourceRefId },
                { itemId: job.itemCode }
              ]
            });
          }

          // Strategy 3: Search by PO number
          if (!pr && job.sourceRefId) {
            const Purchase = (await import('../models/Purchase.js')).default;
            const po = await Purchase.findOne({ purchaseOrderNumber: job.sourceRefId });
            if (po) {
              pr = await PurchaseRequest.findOne({ purchaseOrder: po._id });
            }
          }

          console.log(`[QC Approval - Purchase] PR lookup result:`, pr ? `Found PR ${pr.requestId}, storeOrderId: ${pr.storeOrderId}` : 'Not found');

          if (pr && pr.storeOrderId) {
            // storeOrderId can be an Order _id OR a Sale _id — try both
            let salePurch = await Sale.findOne({
              $or: [
                { order: pr.storeOrderId },
                { _id: pr.storeOrderId }
              ]
            });

            // Also try matching by the itemId stored on the PR
            if (!salePurch && pr.itemId) {
              salePurch = await Sale.findOne({
                $or: [
                  { invoiceNumber: pr.itemId },
                  { _id: /^[0-9a-fA-F]{24}$/.test(pr.itemId) ? pr.itemId : null }
                ]
              });
            }

            if (salePurch) {
              const finalCatLower = (job.category || '').toLowerCase().trim();
              const isMachine = finalCatLower === 'purchase machine' || finalCatLower === 'manufacturing machine';
              if (isMachine) {
                salePurch.storeQCStatus = 'Approved from QC';
                console.log(`✅ [QC Approval - Purchase Machine] storeQCStatus='Approved from QC' for Sale ${salePurch._id}`);
              } else {
                salePurch.storeQCStatus = 'Purchase Completed';
                console.log(`✅ [QC Approval - Purchase Material] storeQCStatus='Purchase Completed' for Sale ${salePurch._id}`);
              }
              await salePurch.save();
            } else {
              console.warn(`⚠️ [QC Approval - Purchase] PR ${pr.requestId} found but could not locate linked Sale (storeOrderId: ${pr.storeOrderId})`);
            }
          } else if (!pr) {
            console.warn(`⚠️ [QC Approval - Purchase] Could not find PurchaseRequest for QC Job ${job.qcJobId}. sourceRefId: ${job.sourceRefId}, itemCode: ${job.itemCode}`);
          } else {
            console.warn(`⚠️ [QC Approval - Purchase] PR ${pr.requestId} has no storeOrderId — skipping Sale status update`);
          }
        } catch (e) { console.error('❌ Error updating purchase status on QC Approval:', e); }
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
        // For Store source: restore inventory qty (item was deducted when sent to QC, now it's rejected so it comes back)
        if (job.source === 'Store') {
          try {
            let inventoryItem = null;
            if (job.itemCode && /^[0-9a-fA-F]{24}$/.test(job.itemCode)) {
              inventoryItem = await Item.findById(job.itemCode);
            }
            if (!inventoryItem && job.itemCode) {
              inventoryItem = await Item.findOne({ code: job.itemCode, store: job.company.toString() });
            }
            if (!inventoryItem && job.itemName) {
              inventoryItem = await Item.findOne({ name: job.itemName, store: job.company.toString() });
            }
            if (inventoryItem) {
              const prevQty = inventoryItem.qty || 0;
              inventoryItem.qty = prevQty + (job.quantity || 1);
              await inventoryItem.save();
              console.log(`↩️ [QC Rejection - Store] Restored ${job.quantity || 1} qty to ${inventoryItem.name}. New qty: ${inventoryItem.qty}`);
            }
          } catch (restoreErr) {
            console.error('❌ Error restoring inventory on QC rejection:', restoreErr);
          }
        }

        // Auto-create production order for rejected production/store items
        try {
          await createRejectedProductionOrder(job, req.user);
          console.log(`✅ [QC Rejection] Created production order for rejected item: ${job.itemName}`);
        } catch (prodError) {
          console.error('❌ Error creating production order for rejected item:', prodError);
        }

        // Update linked Sale storeQCStatus to 'Rejected from QC' so Store knows
        try {
          // Strategy 1: Use direct saleId (set at QC job creation time)
          let saleRej = null;
          if (job.saleId) {
            saleRej = await Sale.findById(job.saleId);
          }

          // Strategy 2: Fall back to sourceRefId
          if (!saleRej && job.sourceRefId) {
            saleRej = await Sale.findOne({
              $or: [
                { invoiceNumber: job.sourceRefId },
                { _id: /^[0-9a-fA-F]{24}$/.test(job.sourceRefId) ? job.sourceRefId : null }
              ]
            });
          }

          if (saleRej) {
            saleRej.storeQCStatus = 'Rejected from QC';
            await saleRej.save();
            console.log(`✅ [QC Rejection] storeQCStatus='Rejected from QC' for Sale ${saleRej._id}`);
          } else {
            console.warn(`⚠️ [QC Rejection] Could not find linked Sale for QC Job ${job.qcJobId}`);
          }
        } catch (saleRejErr) {
          console.error('❌ Error updating sale storeQCStatus on rejection:', saleRejErr);
        }
      }
    }

    await job.save();

    // 🔔 Notify based on QC decision
    try {
      if (decision === 'Pass') {
        await notificationService.triggerQCNotification({
          action: 'qc_passed',
          data: { qcJobId: job.qcJobId, itemName: job.itemName, jobId: job._id },
          targetCompanyId: job.company,
        });
      } else {
        await notificationService.triggerQCNotification({
          action: 'qc_failed',
          data: { qcJobId: job.qcJobId, itemName: job.itemName, failReason: job.failReason, jobId: job._id },
          targetCompanyId: job.company,
        });
      }
    } catch (e) { console.error('QC decision notification error:', e); }

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
      purpose: 'Order',   // Rejected items are always re-made for the original order
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
