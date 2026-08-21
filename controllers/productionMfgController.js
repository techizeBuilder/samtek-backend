import ProductionOrder, { PROCESS_STEPS, PROCESS_TYPE_MAP, buildProcessSteps } from '../models/ProductionOrder.js';
import ProductionTeam from '../models/ProductionTeam.js';
import Sale from '../models/Sale.js';
import QCJob from '../models/QCJob.js';
import notificationService from '../services/notificationService.js';
import RDRequest from '../models/RDRequest.js'
import RDBOM from '../models/RDBOM.js';
import mongoose from 'mongoose';
import { Item } from '../models/Inventory.js'; // Adjust path
import MaterialIssueLog from '../models/MaterialIssueLog.js';
import { recalculateItemPricing } from '../services/itemPricingService.js';
import { resolveFabricationWeight, dimensionSignature, buildFabricationBomDimensions } from '../services/fabricationDemandService.js';

import PDFDocument from 'pdfkit';


import MaterialReturnLog from '../models/MaterialReturnLog.js';

// A non-fabrication material whose Used Unit is Length/Area/Volume needs an
// amountValue too (see addMaterialDemand below) — mirrors rdController.js's
// identically-named helper for BOM materials. purchaseCost is ₹ per Used
// Unit, and a flat quantity alone can't say "2 pieces of 1m length each" the
// way it can say "5 kg" or "3 pieces" for Mass/Count materials.
const AMOUNT_UNIT_TYPES = ['Length Unit', 'Area Unit', 'Volume Unit'];
const itemNeedsAmount = (sourceItem) => !sourceItem.fabricationRef && AMOUNT_UNIT_TYPES.includes(sourceItem.unitType);




const today = () => new Date().toISOString().split('T')[0];

// ─── ORDER ID GENERATOR ───────────────────────────────────────────────────────
async function generateOrderId(companyId) {
  const year = new Date().getFullYear();
  const count = await ProductionOrder.countDocuments({ company: companyId });
  return `ORD-${year}-${String(count + 1).padStart(3, '0')}`;
}

// Auto-creates (or reuses) the central QC intake job for a Production Order's
// output — used once the last process step is QC-approved (approveQC below)
// and, identically, once a Repair job is marked complete.
async function createQCJobForCompletedOrder(order, sentBy, userId) {
  const existingQC = await QCJob.findOne({
    source: order.source === 'QC_Rejected' ? 'QC_Rejected' : (order.source === 'Stock' ? 'Stock' : 'Production'),
    sourceRefId: order.orderId,
    company: order.company
  });
  if (existingQC) return existingQC;

  const year = new Date().getFullYear();
  const lastJob = await QCJob.findOne({
    qcJobId: new RegExp(`^QC-${year}-`)
  }).sort({ qcJobId: -1 }).lean();

  let nextNumber = 1;
  if (lastJob && lastJob.qcJobId) {
    const parts = lastJob.qcJobId.split('-');
    if (parts.length === 3) {
      const lastNumber = parseInt(parts[2]);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }
  }
  const qcJobId = `QC-${year}-${String(nextNumber).padStart(4, '0')}`;

  let qcCategory = 'Finished Good';
  try {
    const inventoryItem = await Item.findOne({
      $or: [{ code: order.machineCode }, { name: order.machineName }],
      companyId: order.company
    });
    if (inventoryItem && inventoryItem.category) qcCategory = inventoryItem.category;
  } catch (itemErr) {
    console.error('Error looking up inventory item for category:', itemErr);
  }

  const qcJob = await QCJob.create({
    qcJobId,
    source: order.source === 'QC_Rejected' ? 'QC_Rejected' : (order.source === 'Stock' ? 'Stock' : 'Production'),
    sourceRefId: order.orderId,
    sourceDepartment: 'Production',
    sentBy: sentBy || 'Production Dept',
    itemName: order.machineName,
    itemCode: order.machineCode,
    category: qcCategory,
    quantity: order.orderQuantity || 1,
    unit: 'pcs',
    receivedDate: today(),
    status: 'Pending',
    saleId: order.saleId,
    saleItemId: order.saleItemId || null,
    orderCode: order.orderCode || '',
    company: order.company,
    createdBy: userId,
    // Repair jobs carry forward what was actually fixed/replaced, so QC can see
    // it while re-inspecting instead of just a generic auto-created message.
    notes: (order.reworkDecision === 'Repair' && order.repair?.notes)
      ? `Repaired: ${order.repair.notes}`
      : `Automatically created from completed Production Order: ${order.orderId}`
  });
  console.log(`✅ QC Job ${qcJobId} automatically created for Production Order ${order.orderId}`);

  try {
    await notificationService.triggerQCNotification({
      action: 'qc_job_created',
      data: { qcJobId, itemName: order.machineName, jobId: qcJob._id },
      targetCompanyId: order.company,
    });
  } catch (e) { console.error('QC job notification error:', e); }

  return qcJob;
}

// ─── ORDERS ───────────────────────────────────────────────────────────────────

const VALID_ORDER_STATUSES = ['Pending', 'BOM Pending', 'In Progress', 'On Hold', 'Completed'];

export const getOrders = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { page = 1, limit = 20, search, status, source } = req.query;
    const skip = (page - 1) * limit;

    const query = { company: companyId };
    if (status && status !== 'all' && VALID_ORDER_STATUSES.includes(status)) {
      query.status = status;
    }

    // $and holds the search/source conditions separately since both would
    // otherwise need the top-level `$or` key.
    const andConditions = [];
    if (search) {
      andConditions.push({
        $or: [
          { orderId: { $regex: search, $options: 'i' } },
          { orderCode: { $regex: search, $options: 'i' } },
          { machineCode: { $regex: search, $options: 'i' } },
          { machineName: { $regex: search, $options: 'i' } },
        ]
      });
    }
    if (source === 'Store') {
      // Legacy records predate the `source` field, so missing == Store.
      andConditions.push({ $or: [{ source: { $exists: false } }, { source: 'Store' }] });
    } else if (source === 'QC_Rejected' || source === 'Stock') {
      query.source = source;
    }
    if (andConditions.length) query.$and = andConditions;

    const [orders, total, summaryAgg] = await Promise.all([
      ProductionOrder.find(query)
        .populate('processes.assignedTeam', 'name supervisor members')
        .populate('extraUnits.processes.assignedTeam', 'name supervisor members')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ProductionOrder.countDocuments(query),
      // Summary reflects ALL of the company's orders (not just the current
      // page/filter), matching the stat-card behavior the Orders page has
      // always had — these are global counters, not "count of this search".
      ProductionOrder.aggregate([
        { $match: { company: new mongoose.Types.ObjectId(companyId) } },
        {
          $facet: {
            statusCounts: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            priorityCounts: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
            sourceCounts: [{ $group: { _id: '$source', count: { $sum: 1 } } }],
            total: [{ $count: 'count' }],
          }
        }
      ]),
    ]);

    const facet = summaryAgg[0] || { statusCounts: [], priorityCounts: [], sourceCounts: [], total: [] };
    const countFrom = (arr, key) => (arr.find(a => a._id === key)?.count) || 0;
    const summary = {
      total: facet.total[0]?.count || 0,
      pending: countFrom(facet.statusCounts, 'Pending'),
      bomPending: countFrom(facet.statusCounts, 'BOM Pending'),
      inProgress: countFrom(facet.statusCounts, 'In Progress'),
      onHold: countFrom(facet.statusCounts, 'On Hold'),
      completed: countFrom(facet.statusCounts, 'Completed'),
      urgent: countFrom(facet.priorityCounts, 'Urgent'),
      storeOrders: countFrom(facet.sourceCounts, 'Store'),
      rejectedOrders: countFrom(facet.sourceCounts, 'QC_Rejected'),
    };

    res.json({
      success: true,
      data: {
        orders,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
        summary,
      }
    });
  } catch (err) {
    console.error('❌ Error in getOrders:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Lightweight "current work" feed for board/kanban-style pages (Work
// Planning, Process & QC order-picker, Manpower's live board) — these only
// ever operate on non-Completed orders, so unlike getOrders above this isn't
// paginated: it's bounded by how much work is actually in flight, not by
// total order history. Orders completed within the last 7 days stay visible
// too, so Process & QC's picker doesn't yank a just-finished order out from
// under a user mid-workflow.
export const getActiveOrders = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const orders = await ProductionOrder.find({
      company: companyId,
      $or: [
        { status: { $ne: 'Completed' } },
        { updatedAt: { $gte: sevenDaysAgo } },
      ],
    })
      .populate('processes.assignedTeam', 'name supervisor members')
      .populate('extraUnits.processes.assignedTeam', 'name supervisor members')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    res.json({ success: true, data: orders });
  } catch (err) {
    console.error('❌ Error in getActiveOrders:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// On-demand history for a single team, used by Manpower's "View Full
// History" modal — fetched only when that modal opens, so the shared
// context never has to carry every team's entire history up front.
export const getTeamOrderHistory = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { teamId } = req.params;

    const orders = await ProductionOrder.find({
      company: companyId,
      $or: [
        { 'processes.assignedTeam': teamId },
        { 'extraUnits.processes.assignedTeam': teamId },
      ],
    })
      .populate('processes.assignedTeam', 'name supervisor members')
      .populate('extraUnits.processes.assignedTeam', 'name supervisor members')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ success: true, data: orders });
  } catch (err) {
    console.error('❌ Error in getTeamOrderHistory:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createOrder = async (req, res) => {
  try {
    const { machineCode, machineName, priority, deliveryDate, source, rejectionDetails } = req.body;
    if (!machineCode || !machineName || !deliveryDate) {
      return res.status(400).json({ success: false, message: 'machineCode, machineName and deliveryDate are required' });
    }

    // Generate appropriate order ID based on source
    let orderId;
    if (source === 'QC_Rejected') {
      const year = new Date().getFullYear();
      const lastRejectedOrder = await ProductionOrder.findOne({
        orderId: new RegExp(`^REJ-${year}-`)
      }).sort({ orderId: -1 }).lean();

      let nextNumber = 1;
      if (lastRejectedOrder && lastRejectedOrder.orderId) {
        const parts = lastRejectedOrder.orderId.split('-');
        if (parts.length === 3) {
          const lastNumber = parseInt(parts[2]);
          if (!isNaN(lastNumber)) {
            nextNumber = lastNumber + 1;
          }
        }
      }
      orderId = `REJ-${year}-${String(nextNumber).padStart(4, '0')}`;
    } else {
      orderId = await generateOrderId(req.user.companyId);
    }

    const order = await ProductionOrder.create({
      orderId,
      machineCode,
      machineName,
      priority: priority || (source === 'QC_Rejected' ? 'Urgent' : 'Normal'),
      source: source || 'Stock', // manually created = 'Stock' by default (no linked sale)
      rejectionDetails: rejectionDetails || {},
      receivedDate: today(),
      deliveryDate,
      company: req.user.companyId,
      createdBy: req.user._id,
    });

    // 🔔 Notify Production Head & Employee about new order
    try {
      await notificationService.triggerProductionNotification({
        action: 'order_for_production',
        data: { orderCode: order.orderId, orderId: order._id, machineName },
        targetCompanyId: req.user.companyId,
      });
    } catch (e) { console.error('Production order notification error:', e); }

    res.status(201).json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const verifyBOM = async (req, res) => {
  try {
    const order = await ProductionOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { bomVerified: true },
      { new: true }
    );
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const verifyDesign = async (req, res) => {
  try {
    const order = await ProductionOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { designVerified: true },
      { new: true }
    );
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Fast-fetch utility
const getTrueMachineCode = async (machineName, companyId) => {
  const item = await Item.findOne({ name: machineName, companyId })
    .select('code -_id')
    .lean();

  if (!item) throw new Error(`Machine name "${machineName}" not found in Inventory.`);
  return item.code;
};

export const raiseRDRequest = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({
      _id: req.params.id,
      company: req.user.companyId
    });

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // 1. Get the true code from inventory based on the machine name
    const trueCode = await getTrueMachineCode(order.machineName, req.user.companyId);

    // 2. Create the workspace for R&D
    await RDRequest.create({
      productionOrderId: order._id,
      machineCode: trueCode, // Pass the corrected code
      machineName: order.machineName,
      company: req.user.companyId
    });

    // 3. Update the Production Order with the corrected code and new status
    order.machineCode = trueCode;
    order.rdRequestRaised = true;
    order.status = 'BOM Pending';
    await order.save();

    res.json({ success: true, message: 'R&D Request raised successfully.', data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── QC-REJECTED ORDER: REWORK / REPAIR DECISION ───────────────────────────────
// A QC_Rejected order sits with reworkDecision='Pending' (BOM/R&D UI hidden)
// until Production explicitly picks one of these two paths.

export const decideRework = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId, source: 'QC_Rejected' });
    if (!order) return res.status(404).json({ success: false, message: 'Rejected order not found' });
    if (order.reworkDecision !== 'Pending') {
      return res.status(400).json({ success: false, message: `Decision already made: ${order.reworkDecision}` });
    }
    // Rework = rebuild from scratch, same as this order's default automatic
    // pipeline (BOM verify → material issue → process steps → QC), just now
    // gated behind an explicit choice instead of firing immediately.
    order.reworkDecision = 'Rework';
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const decideRepair = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId, source: 'QC_Rejected' });
    if (!order) return res.status(404).json({ success: false, message: 'Rejected order not found' });
    if (order.reworkDecision !== 'Pending') {
      return res.status(400).json({ success: false, message: `Decision already made: ${order.reworkDecision}` });
    }
    order.reworkDecision = 'Repair';
    order.status = 'On Hold'; // parks it out of the normal active-production board
    order.repair.status = 'Pending';
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── REPAIR PRODUCTION MODULE ──────────────────────────────────────────────────
// Repair jobs are QC_Rejected Production Orders that were routed here instead
// of the full rebuild pipeline — same record, filtered by reworkDecision.

export const getRepairJobs = async (req, res) => {
  try {
    const orders = await ProductionOrder.find({ company: req.user.companyId, reworkDecision: 'Repair' })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const startRepair = async (req, res) => {
  try {
    const { assignedTo } = req.body;
    if (!assignedTo || !assignedTo.trim()) {
      return res.status(400).json({ success: false, message: 'A supervisor/team must be assigned before starting a repair.' });
    }
    const order = await ProductionOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, reworkDecision: 'Repair' },
      { 'repair.status': 'In Progress', 'repair.assignedTo': assignedTo.trim() },
      { new: true }
    );
    if (!order) return res.status(404).json({ success: false, message: 'Repair job not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const completeRepair = async (req, res) => {
  try {
    const { notes } = req.body;
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId, reworkDecision: 'Repair' });
    if (!order) return res.status(404).json({ success: false, message: 'Repair job not found' });
    if (order.repair.status === 'Completed') {
      return res.status(400).json({ success: false, message: 'Repair already completed' });
    }

    order.repair.status = 'Completed';
    order.repair.notes = notes || order.repair.notes;
    order.repair.completedAt = new Date();
    order.status = 'Completed';
    await order.save();

    // Repaired qty re-enters the same central QC intake pipeline as any
    // finished production run — Approve in QC then behaves exactly like a
    // normal QC_Rejected Pass (routes straight to dispatch for the original
    // order); Fail re-runs this same Rework/Repair choice again.
    try {
      await createQCJobForCompletedOrder(order, 'Repair Dept', req.user._id);
    } catch (qcErr) {
      console.error('❌ Error creating QC Job for completed repair:', qcErr);
    }

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};







export const receiveMaterialInProduction = async (req, res) => {
  try {
    const { materialCode, receivedQuantity } = req.body;
    const orderId = req.params.id;
    const companyId = req.user.companyId;

    const recQty = Number(receivedQuantity);

    if (!materialCode || !recQty || recQty <= 0) {
      return res.status(400).json({ success: false, message: 'Valid material code and received quantity are required.' });
    }

    // 1. Fetch the Order
    const order = await ProductionOrder.findOne({ _id: orderId, company: companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    // 2. Find the specific material demand
    const demandIndex = order.materialDemands.findIndex(m => m.materialCode === materialCode);
    if (demandIndex === -1) {
      return res.status(404).json({ success: false, message: 'Material not found in this order.' });
    }
    const demand = order.materialDemands[demandIndex];

    // 3. Gatekeeper: Is it in transit?
    if (demand.status !== 'In Transit') {
      return res.status(400).json({ success: false, message: 'No material currently in transit to receive.' });
    }

    // 4. Calculate exactly how much is sitting on the cart
    const inTransitQty = (demand.transferredQuantity || 0) - (demand.issuedQuantity || 0);

    // 🚨 NEW STRICT GATEKEEPER: Force exact receipt
    if (recQty !== inTransitQty) {
      return res.status(400).json({
        success: false,
        message: `Partial receipts disabled. You must receive exactly the in-transit amount: ${inTransitQty} ${demand.unit}.`
      });
    }

    // 5. UPDATE RECEIVED QUANTITY
    const newIssuedQty = (demand.issuedQuantity || 0) + recQty;
    order.materialDemands[demandIndex].issuedQuantity = newIssuedQty;

    // 6. SIMPLIFIED STATUS ROUTING
    // Since they always receive the full cart, there is no "Scenario B". 
    // It's either completely fulfilled, or they still need more from the store.
    if (newIssuedQty >= demand.quantity) {
      order.materialDemands[demandIndex].status = 'Issued';
    } else {
      order.materialDemands[demandIndex].status = 'Requested';
    }

    // 7. Auto-Complete Check for the whole order
    const allIssued = order.materialDemands.every(m => m.status === 'Issued');
    if (allIssued) {
      order.materialIssued = true;
    }

    await order.save();

    // 8. GENERATE AUDIT LOG
    await MaterialIssueLog.create({
      productionOrderId: order._id,
      orderId: order.orderId,
      machineCode: order.machineCode,
      materialCode: demand.materialCode,
      materialName: demand.materialName,
      sourceItemCode: demand.sourceItemCode || demand.materialCode,
      fabricationCategory: demand.fabricationCategory || '',
      bomDimensions: demand.bomDimensions || null,
      quantityIssued: recQty,
      unit: demand.unit,
      issuedTo: req.user._id,
      company: companyId
    });

    res.json({
      success: true,
      data: order,
      message: `Successfully received all ${recQty} ${demand.unit} of ${demand.materialName}.`
    });

  } catch (err) {
    console.error("Error receiving material:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};



// ─────────────────────────────────────────────────────────────
// API 1: ADD / UPDATE MATERIAL DEMAND (Production Floor)
// ─────────────────────────────────────────────────────────────
export const addMaterialDemand = async (req, res) => {
  try {
    const { materialCode, materialName, quantity, unit, dimensionVariantId, amountValue, amountUnit, targetDemandCode } = req.body;

    if (!materialCode || !materialName || !quantity || !unit) {
      return res.status(400).json({ success: false, message: 'All material fields are required' });
    }

    const companyId = req.user.companyId;
    const orderId = req.params.id;

    const order = await ProductionOrder.findOne({ _id: orderId, company: companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // materialCode may not match any real Inventory item at all — Production
    // can request an ad-hoc/out-of-catalog material by name (existing
    // behavior, unchanged: no Item required). Fabrication-aware pricing only
    // kicks in when it DOES resolve to a fabrication-linked Item.
    const sourceItem = await Item.findOne({ code: materialCode.trim(), companyId });

    // Fabrication materials (sourceItem.fabricationRef set) are keyed by
    // weight+cut, not a flat code — mirrors rdController.js's
    // processRDRequest merge-key logic. targetDemandCode, when given, pins
    // this request to one EXACT existing demand line (Production adjusting
    // an already-demanded cut's quantity) instead of deriving a key from
    // freshly-entered dimensions — avoids a mistyped dimension silently
    // creating a duplicate line instead of updating the right one.
    let demandMaterialCode = targetDemandCode || materialCode;
    let fabricationFields = sourceItem ? { sourceItemCode: sourceItem.code } : {};

    if (!targetDemandCode && sourceItem?.fabricationRef) {
      if (!dimensionVariantId || !(Number(amountValue) > 0) || !amountUnit) {
        return res.status(400).json({ success: false, message: 'A dimension size, amount, and amount unit are required for a Fabrication Master material.' });
      }
      const bomDimensions = buildFabricationBomDimensions(sourceItem, dimensionVariantId, amountValue, amountUnit);
      if (!bomDimensions) {
        return res.status(400).json({ success: false, message: 'Chosen dimension size not found on this item, or the amount unit is invalid for its shape.' });
      }
      const fabWeight = await resolveFabricationWeight(sourceItem, bomDimensions, bomDimensions.designation);
      if (!fabWeight || !(fabWeight.weightPerPieceKg > 0)) {
        return res.status(400).json({ success: false, message: 'Could not resolve this fabrication item\'s weight from the chosen size and amount.' });
      }
      demandMaterialCode = `${sourceItem.code}#${dimensionSignature(bomDimensions)}`;
      fabricationFields = {
        sourceItemCode: sourceItem.code,
        bomDimensions,
        fabricationCategory: fabWeight.fabricationCategory,
        computedWeightPerPieceKg: fabWeight.weightPerPieceKg,
        unitPrice: Math.round(fabWeight.weightPerPieceKg * (sourceItem.weightUnitPrice || 0) * 100) / 100,
        dimensionVariantId,
        amountValue: Number(amountValue),
        amountUnit,
      };
    } else if (!targetDemandCode && sourceItem && itemNeedsAmount(sourceItem)) {
      // Non-fabrication Length/Area/Volume material — carries an amountValue
      // (the per-piece size) purely as display metadata; `quantity` (below,
      // shared with every other demand) is already the resolved TOTAL amount
      // needed, computed client-side from Amount x Pieces before it ever
      // reaches here (see UnitAmountField.jsx) — so pricing/stock deduction
      // stay flat, unaffected by amountValue, same as every other material.
      // amountUnit is never trusted from the client — always the item's own
      // Used Unit (the form no longer offers a separate amount-unit picker).
      if (!(Number(amountValue) > 0)) {
        return res.status(400).json({ success: false, message: `An amount (in ${sourceItem.unit}) is required for this material.` });
      }
      demandMaterialCode = `${sourceItem.code}#${Number(amountValue)}${sourceItem.unit}`;
      fabricationFields = {
        sourceItemCode: sourceItem.code,
        unitPrice: sourceItem.purchaseCost || 0,
        amountValue: Number(amountValue),
        amountUnit: sourceItem.unit,
      };
    }

    const materialExists = order.materialDemands.find(m => m.materialCode === demandMaterialCode);

    // 🚨 ONLY BLOCK: Prevent changing demand if the physical
    // material is actively being moved by the store right now.
    if (materialExists && materialExists.status === 'In Transit') {
      return res.status(400).json({
        success: false,
        message: 'Cannot change demand while this material is currently In Transit from the store.'
      });
    }

    const originalBomQty = materialExists && materialExists.bomQuantity !== undefined
      ? materialExists.bomQuantity : null;

    // Capture previous quantity so we can revert if R&D rejects
    const previousQuantity = materialExists ? materialExists.quantity : null;

    let updatedOrder;
    if (materialExists) {
      updatedOrder = await ProductionOrder.findOneAndUpdate(
        { _id: orderId, "materialDemands.materialCode": demandMaterialCode },
        {
          $set: {
            "materialDemands.$.status": "Pending R&D",
            "materialDemands.$.quantity": Number(quantity),
            "materialDemands.$.unit": unit
          }
        },
        { new: true }
      );
    } else {
      updatedOrder = await ProductionOrder.findOneAndUpdate(
        { _id: orderId },
        {
          $push: {
            materialDemands: {
              materialCode: demandMaterialCode, materialName, bomQuantity: null,
              quantity: Number(quantity), unit, status: 'Pending R&D',
              ...fabricationFields,
            }
          }
        },
        { new: true }
      );
    }

    await RDRequest.create({
      productionOrderId: order._id,
      machineCode: order.machineCode,
      machineName: order.machineName,
      requestType: 'Material Change',
      materialChangeDetails: {
        materialCode: demandMaterialCode,
        materialName,
        bomQuantity: originalBomQty,
        requestedQuantity: Number(quantity),
        previousQuantity, // 👈 Saved for Rejection Rollbacks
        unit
      },
      company: companyId
    });

    res.json({ success: true, data: updatedOrder, message: 'Demand sent to R&D for approval.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// controllers/productionMfgController.js

export const returnMaterialToStore = async (req, res) => {
  try {
    // 🚨 Added returnType ('Excess' or 'Defect') from the production client interface
    const { materialCode, returnQuantity, reason, returnType } = req.body;
    const orderId = req.params.id;
    const companyId = req.user.companyId;

    const retQty = Number(returnQuantity);

    if (!materialCode || !retQty || retQty <= 0) {
      return res.status(400).json({ success: false, message: 'Valid material code and return quantity are required.' });
    }

    if (!['Excess', 'Defect'].includes(returnType)) {
      return res.status(400).json({ success: false, message: 'Invalid return type. Must be Excess or Defect.' });
    }

    const order = await ProductionOrder.findOne({ _id: orderId, company: companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    const demand = order.materialDemands.find(m => m.materialCode === materialCode);
    if (!demand) return res.status(404).json({ success: false, message: 'Material not found in this order.' });

    // Calculate real physical availability left on the floor
    const availableOnFloor = (demand.issuedQuantity || 0) - (demand.returnPendingQuantity || 0);

    if (retQty > availableOnFloor) {
      return res.status(400).json({
        success: false,
        message: `Cannot return ${retQty}. Only have ${availableOnFloor} items available on the production floor.`
      });
    }

    // ✅ Increment the specific quantitative lock field instead of altering demand.status
    demand.returnPendingQuantity = (demand.returnPendingQuantity || 0) + retQty;
    await order.save();

    // Log the transaction request along with the context tag for the store panel
    await MaterialReturnLog.create({
      productionOrderId: order._id,
      orderId: order.orderId,
      machineCode: order.machineCode,
      materialCode: demand.materialCode,
      sourceItemCode: demand.sourceItemCode || demand.materialCode,
      fabricationCategory: demand.fabricationCategory || '',
      bomDimensions: demand.bomDimensions || null,
      materialName: demand.materialName,
      quantityReturned: retQty,
      unit: demand.unit,
      returnedBy: req.user._id,
      reason: reason || `${returnType} material return`,
      returnType: returnType, // 👈 Saved directly to log database schema
      company: companyId,
      status: 'Pending'
    });

    res.json({
      success: true,
      message: `${returnType} return request for ${retQty} ${demand.unit} submitted. Awaiting Store verification.`
    });

  } catch (err) {
    console.error("Error in returnMaterialToStore:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// download the material list

export const downloadMaterialListPDF = async (req, res) => {
  try {
    const { id } = req.params;

    // Find production order profile records
    const order = await ProductionOrder.findById(id);
    if (!order) {
      return res.status(404).json({ message: "Production order document not found." });
    }

    // Initialize a clean, letter-sized document with structural margins
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });

    // Set streaming response configurations
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=MaterialList-${order.orderId}.pdf`);

    doc.pipe(res);

    // ── BRAND IDENTITY HEADER ──
    doc.fillColor('#1e293b').fontSize(22).font('Helvetica-Bold').text('SAMTEK MACHINERY', 50, 50);
    doc.fillColor('#64748b').fontSize(9).font('Helvetica').text('Production Material Ledger & Performance Report', 50, 75);

    // Horizontal visual bounding divider line
    doc.moveTo(50, 92).lineTo(562, 92).strokeColor('#e2e8f0').lineWidth(1).stroke();

    // ── METADATA PROFILE BLOCK ──
    doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold').text(`Production Order ID: #${order.orderId}`, 50, 115);

    doc.fillColor('#334155').fontSize(9).font('Helvetica');
    doc.text(`Machine Asset: ${order.machineCode} — ${order.machineName}`, 50, 135);
    doc.text(`Fulfillment State: ${order.status}`, 50, 150);
    doc.text(`Target Delivery Frame: ${order.deliveryDate}`, 50, 165);
    doc.text(`Generated Date: ${new Date().toLocaleDateString()}`, 50, 180);

    // ── MATERIAL DEMAND SUMMARY TABLE HEADER ──
    doc.fillColor('#1e3a8a').fontSize(11).font('Helvetica-Bold').text('Completed Material Allocation Ledger', 50, 215);

    const tableTop = 235;
    doc.rect(50, tableTop, 512, 22).fill('#f8fafc');

    // Draw Table Columns String Labels
    doc.fillColor('#475569').fontSize(9).font('Helvetica-Bold');
    doc.text('Item Code', 60, tableTop + 6, { width: 80 });
    doc.text('Material Name', 150, tableTop + 6, { width: 160 });
    doc.text('Req Qty', 320, tableTop + 6, { width: 50, align: 'center' });
    doc.text('Transferred', 380, tableTop + 6, { width: 65, align: 'center' });
    doc.text('Issued', 455, tableTop + 6, { width: 50, align: 'center' });
    doc.text('Status', 510, tableTop + 6, { width: 45, align: 'right' });

    let currentY = tableTop + 22;

    // ── INTERACTION LOOP FOR PRODUCTION ORDER DEMANDS ──
    order.materialDemands.forEach((item) => {
      // Fabrication demand lines carry a synthetic per-cut materialCode
      // (itemCode#dimensionSignature) used as a tracking key — the real
      // Inventory code is sourceItemCode. The ledger should print the real
      // code and show what size was cut, not the internal tracking key.
      const hasCut = item.fabricationCategory && item.bomDimensions && Object.keys(item.bomDimensions).length > 0;
      const rowHeight = hasCut ? 30 : 22;

      // Check for page overflow limits dynamically
      if (currentY + rowHeight > 700) {
        doc.addPage();
        currentY = 50; // Reset height position for additional pages
      }

      // Draw border line separator frame
      doc.moveTo(50, currentY + rowHeight).lineTo(562, currentY + rowHeight).strokeColor('#f1f5f9').lineWidth(1).stroke();

      // Populate Item Text Strings
      doc.fillColor('#334155').fontSize(9).font('Helvetica');
      doc.text(item.sourceItemCode || item.materialCode, 60, currentY + 7, { width: 80 });
      doc.text(item.materialName, 150, currentY + 7, { width: 160 });
      doc.text(`${item.quantity} ${item.unit}`, 320, currentY + 7, { width: 50, align: 'center' });
      doc.text(`${item.transferredQuantity} ${item.unit}`, 380, currentY + 7, { width: 65, align: 'center' });
      doc.text(`${item.issuedQuantity} ${item.unit}`, 455, currentY + 7, { width: 50, align: 'center' });

      // Format styling explicitly for status string layout values
      const statusColor = item.status === 'Issued' ? '#16a34a' : '#475569';
      doc.fillColor(statusColor).font('Helvetica-Bold');
      doc.text(item.status, 510, currentY + 7, { width: 45, align: 'right' });

      if (hasCut) {
        const dimsText = Object.entries(item.bomDimensions)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${k}:${v}`).join(', ');
        doc.fillColor('#94a3b8').fontSize(7).font('Helvetica').text(`Cut: ${dimsText}`, 150, currentY + 19, { width: 300 });
      }

      currentY += rowHeight;
    });

    // Finalize compilation processing
    doc.end();

  } catch (error) {
    console.error("Critical error building production ledger summary PDF file streams:", error);
    res.status(500).json({ message: "Internal application error building asset documentation reports." });
  }
};

export const updateMaterialStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await ProductionOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, 'materialDemands._id': req.params.materialId },
      { $set: { 'materialDemands.$.status': status } },
      { new: true }
    );
    if (!order) return res.status(404).json({ success: false, message: 'Order or material not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PROCESS OPERATIONS ───────────────────────────────────────────────────────

// stepIndex: 0–5 mapping to PROCESS_STEPS array
function getStepIndex(req, res) {
  const idx = parseInt(req.params.stepIndex, 10);
  if (isNaN(idx) || idx < 0 || idx >= PROCESS_STEPS.length) {
    res.status(400).json({ success: false, message: 'Invalid step index (0–5)' });
    return -1;
  }
  return idx;
}

// Which physical unit (1-based) a process-execution call targets. Defaults
// to 1 so every existing caller that never sends `unit` keeps operating on
// the order's original `processes` field exactly as before.
function getUnitNumber(req) {
  const raw = req.query.unit ?? req.body?.unit;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

// Resolves the process-steps array to mutate for a given unit number.
// Unit 1 = order.processes (unchanged legacy path). Units 2..N live in
// order.extraUnits[0..N-2], lazily created here the first time a multi-unit
// order's process tab is actually touched. Returns null for an out-of-range
// unit number (caller should respond 400).
function getUnitProcesses(order, unitNumber) {
  if (unitNumber <= 1) return order.processes;
  const buildQty = Math.max(1, Number(order.orderQuantity) || 1);
  if (unitNumber > buildQty) return null;
  while (order.extraUnits.length < buildQty - 1) {
    order.extraUnits.push({ processes: buildProcessSteps() });
  }
  return order.extraUnits[unitNumber - 2].processes;
}

// True once every step of every unit (the main `processes` plus all
// `extraUnits`) is Completed. For orderQuantity === 1 orders, extraUnits is
// always [], so this is identical to the original "all processes complete"
// check.
function allUnitsCompleted(order) {
  const mainDone = order.processes.every(p => p.status === 'Completed');

  // extraUnits entries are created LAZILY (see getUnitProcesses) — only the
  // first time that unit's tab is actually opened/worked on. If a unit has
  // never been touched, there's no entry for it at all yet, which is not
  // the same as "no steps outstanding" for it. Without this check,
  // `[].every(...)` on a still-empty extraUnits array is vacuously true,
  // which silently marked a whole multi-unit order Completed the moment
  // Unit 1 alone finished, even with Units 2/3 never started.
  const buildQty = Math.max(1, Number(order.orderQuantity) || 1);
  const extraUnitsExpected = buildQty - 1;
  if (order.extraUnits.length < extraUnitsExpected) return false;

  const extraDone = order.extraUnits.every(u => u.processes.every(p => p.status === 'Completed'));
  return mainDone && extraDone;
}

export const assignTeam = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const { teamId } = req.body;
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });
    procs[idx].assignedTeam = teamId || null;
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const startProcess = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const unitNumber = getUnitNumber(req);

    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // ─────────────────────────────────────────────────────────────
    // NEW GATEKEEPERS: BOM & Material Issue Validation
    // ─────────────────────────────────────────────────────────────
    if (!order.bomVerified) {
      return res.status(400).json({
        success: false,
        message: 'Cannot start process: BOM has not been verified by R&D yet.'
      });
    }

    if (!order.materialIssued) {
      return res.status(400).json({
        success: false,
        message: 'Cannot start process: All required materials have not been issued yet.'
      });
    }
    // ─────────────────────────────────────────────────────────────

    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });

    // Gate: previous step (of this same unit) must be completed
    if (idx > 0 && procs[idx - 1].status !== 'Completed') {
      return res.status(400).json({
        success: false,
        message: `Cannot start ${PROCESS_STEPS[idx]}: ${PROCESS_STEPS[idx - 1]} not yet completed`
      });
    }

    procs[idx].status = 'In Progress';
    procs[idx].startDate = today(); // Assuming today() is defined in your file
    procs[idx].startedAt = new Date(); // precise timestamp, see ProcessStepSchema comment
    order.status = 'In Progress';

    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const markProcessComplete = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });

    const proc = procs[idx];
    if (proc.step === 'Fabrication') {
      if (!proc.subEntries || proc.subEntries.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one sub-entry must be added to Fabrication before marking it as complete.' });
      }
      const allDone = proc.subEntries.every(se => se.status === 'Completed' && se.qcStatus === 'Approved');
      if (!allDone) {
        return res.status(400).json({ success: false, message: 'All Fabrication sub-entries must be completed and QC approved before marking this process as complete.' });
      }
    }

    proc.status = 'QC Pending';
    proc.endDate = today();
    proc.completedAt = new Date(); // precise timestamp, see ProcessStepSchema comment
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const approveQC = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const { qcBy, productionCost, productionExpense } = req.body;
    if (!qcBy) return res.status(400).json({ success: false, message: 'qcBy is required' });

    // 'Final Testing' (the last step) completing means THIS physical unit is
    // now built — capture its real production cost/expense right here,
    // regardless of whether other units in a multi-unit order are still in
    // progress. Required only at this step; earlier steps don't touch cost.
    const isFinalStep = idx === PROCESS_STEPS.length - 1;
    let finalCost, finalExpense;
    if (isFinalStep) {
      const toNonNegNumber = (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : undefined;
      };
      finalCost = toNonNegNumber(productionCost);
      finalExpense = toNonNegNumber(productionExpense);
      if (finalCost === undefined || finalExpense === undefined) {
        return res.status(400).json({ success: false, message: 'productionCost and productionExpense (non-negative numbers) are required to complete Final Testing' });
      }
    }

    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });
    const wasCompleted = order.status === 'Completed';
    procs[idx].status = 'Completed';
    procs[idx].qcStatus = 'Approved';
    procs[idx].qcBy = qcBy;
    procs[idx].qcDate = today();
    // Order is only fully Completed once every step of every unit (main +
    // extraUnits) is done — for single-quantity orders this is identical to
    // the original "all processes complete" check.
    if (allUnitsCompleted(order)) {
      order.status = 'Completed';
    }
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');

    // 🏗️ This unit just finished Final Testing — mark the machine/motor as
    // built (first time only) and push this build's real cost/expense into
    // its BOM, overwriting whatever was there before (a later unit's build
    // always wins over an earlier one — see RDBOM.productionCost). Product
    // Master machines and Motor Master motors now ARE Item documents
    // (productKind:'Machine'/'Motor') — one lookup covers both.
    if (isFinalStep) {
      try {
        const mfgItem = await Item.findOne({
          $or: [{ code: order.machineCode }, { name: order.machineName }],
          companyId: order.company
        });
        if (mfgItem && (mfgItem.productKind === 'Machine' || mfgItem.productKind === 'Motor')) {
          const detailsKey = mfgItem.productKind === 'Machine' ? 'machineDetails' : 'motorDetails';
          if (!mfgItem[detailsKey]?.firstBuiltAt) {
            mfgItem[detailsKey] = mfgItem[detailsKey] || {};
            mfgItem[detailsKey].firstBuiltAt = new Date();
            await mfgItem.save();
          }
          if (mfgItem.internalManufacturing) {
            const bom = await RDBOM.findOne({ machine: mfgItem._id, company: order.company });
            if (bom) {
              bom.productionCost = finalCost;
              bom.productionExpense = finalExpense;
              bom.productionCostSource = 'Actual';
              bom.productionCostUpdatedAt = new Date();
              await bom.save();
            }
            await recalculateItemPricing(mfgItem);
          }
        }
      } catch (pricingErr) {
        console.error('❌ Error recalculating item pricing on unit completion:', pricingErr);
      }
    }

    // 📊 Feed the delivery-date estimator: ONE sample PER PHYSICAL UNIT, not
    // one lump sample for the whole (possibly multi-unit) order. Each unit's
    // own first-step-start → last-step-end span is used, so:
    //   - a 3-unit order still contributes 3 honest per-unit durations
    //     (avgLeadDays stays a genuine "time to build ONE", which the
    //     estimator then multiplies by however many units a new quote needs)
    //   - staggered completion (unit 2 finishing weeks after unit 1) doesn't
    //     inflate the sample — each unit is measured against its own actual
    //     working span, not the whole order's elapsed wall-clock time.
    // Only on the transition into Completed, never on a later re-save.
    if (order.status === 'Completed' && !wasCompleted) {
      try {
        const { recordLeadTimeSample } = await import('../utils/leadTimeStats.js');
        const units = [order.processes, ...order.extraUnits.map(u => u.processes)];
        for (const unitProcs of units) {
          // Prefer the precise startedAt/completedAt timestamps; fall back to
          // the date-only startDate/endDate strings for any step that was
          // started before this field existed (in-flight orders at deploy time).
          const starts = unitProcs.map(p => p.startedAt || p.startDate).filter(Boolean).map(d => new Date(d).getTime());
          const ends = unitProcs.map(p => p.completedAt || p.endDate).filter(Boolean).map(d => new Date(d).getTime());
          if (!starts.length || !ends.length) continue;
          const durationDays = Math.max(0, (Math.max(...ends) - Math.min(...starts)) / (1000 * 60 * 60 * 24));
          await recordLeadTimeSample(order.company, order.machineCode, order.machineName, 'Production', durationDays);
        }
      } catch (e) {
        console.error('Failed to record production lead-time sample:', e.message);
      }
    }

    // 🔔 Notify Packing/Dispatch when all processes are done
    if (order.status === 'Completed') {
      try {
        await notificationService.triggerProductionNotification({
          action: 'production_completed',
          data: { orderCode: order.orderId, batchNo: order.orderId, orderId: order._id, machineName: order.machineName },
          targetCompanyId: order.company,
        });
      } catch (e) { console.error('Production completed notification error:', e); }

      // 🏪 Update linked Sale storeQCStatus to 'Production Completed'
      try {
        // Strategy 1: Use direct saleId reference (most reliable — set when prod order created from Store)
        let linkedSale = null;
        if (order.saleId) {
          linkedSale = await Sale.findById(order.saleId);
        }

        // Strategy 2: Fall back to notes regex (for older records without saleId)
        if (!linkedSale) {
          const notesRefMatch = order.notes ? order.notes.match(/Ref:\s*(\S+)/) : null;
          const sourceRefId = notesRefMatch ? notesRefMatch[1] : null;
          if (sourceRefId) {
            linkedSale = await Sale.findOne({
              $or: [
                { invoiceNumber: sourceRefId },
                { _id: /^[0-9a-fA-F]{24}$/.test(sourceRefId) ? sourceRefId : null }
              ]
            });
          }
        }

        if (linkedSale) {
          // Multi-item: only this Production Order's item flips to
          // 'Production Completed' (sale-level fallback for legacy orders)
          const { setSaleItemStatus } = await import('../services/storeFlowService.js');
          const perItem = await setSaleItemStatus(linkedSale, order.saleItemId, 'Production Completed');
          console.log(`🏪 [Production Completed] 'Production Completed' for Sale ${linkedSale._id}${perItem ? ` (item ${order.saleItemId})` : ' (sale-level)'}`);
        } else {
          console.warn(`⚠️ [Production Completed] Could not find linked Sale for ProductionOrder ${order.orderId}`);
        }
      } catch (saleUpdateErr) {
        console.error('❌ Error updating Sale storeQCStatus on production completion:', saleUpdateErr);
      }

      // (firstBuiltAt + BOM production cost + pricing recalculation now
      // happen per-unit, right when THAT unit's Final Testing completes —
      // see the isFinalStep block above. That covers this whole-order
      // completion too, since it's only reached once every unit is done.)

      // 🏭 Auto-create QC Job for completed production order
      try {
        await createQCJobForCompletedOrder(order, qcBy, req.user._id);
      } catch (qcCreateErr) {
        console.error('❌ Error creating QC Job for completed production order:', qcCreateErr);
      }
    }

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const rejectQC = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const { qcBy, reason } = req.body;
    if (!qcBy) return res.status(400).json({ success: false, message: 'qcBy is required' });
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });
    const proc = procs[idx];
    proc.status = 'In Progress';
    proc.qcStatus = 'Rejected';
    proc.qcBy = qcBy;
    proc.qcDate = today();
    proc.notes = reason || proc.notes;
    proc.reworks.push({ date: today(), reason: reason || '', rejectedBy: qcBy });
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addSubEntry = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const { parentPart, childPart, assignedMember, fabricationType } = req.body;
    if (!parentPart || !childPart || !assignedMember) {
      return res.status(400).json({ success: false, message: 'parentPart, childPart, and assignedMember are required' });
    }
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });
    procs[idx].subEntries.push({ parentPart, childPart, assignedMember, fabricationType: fabricationType || 'Other' });
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const completeSubEntry = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const { subEntryId } = req.params;
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });
    const subEntry = procs[idx].subEntries.id(subEntryId);
    if (!subEntry) return res.status(404).json({ success: false, message: 'Sub-entry not found' });

    subEntry.status = 'Completed';
    // Re-submitting (whether first time or after a rejection) always re-enters the QC
    // queue — mirrors markProcessComplete setting the parent step back to 'QC Pending'.
    subEntry.qcStatus = 'Pending';
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const qcSubEntry = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const { subEntryId } = req.params;
    const { qcStatus, qcBy, reason } = req.body;
    const unitNumber = getUnitNumber(req);

    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });
    const subEntry = procs[idx].subEntries.id(subEntryId);
    if (!subEntry) return res.status(404).json({ success: false, message: 'Sub-entry not found' });

    subEntry.qcStatus = qcStatus || 'Approved';
    if (subEntry.qcStatus === 'Rejected') {
      subEntry.status = 'Pending';
      subEntry.reworks.push({ date: today(), reason: reason || '', rejectedBy: qcBy || '' });
    }
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    await order.populate('extraUnits.processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateProcessNotes = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const { notes } = req.body;
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });
    procs[idx].notes = notes || '';
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── TEAMS ────────────────────────────────────────────────────────────────────

export const getTeams = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const teams = await ProductionTeam.find({ company: companyId, isActive: true }).sort({ createdAt: 1 }).lean();

    // All-time per-team assignment counts (total / completed), independent of
    // the active-orders window ManpowerTracking's main board reads `orders`
    // from — without this, a team's lifetime "Completed"/"Total" tallies
    // would incorrectly shrink to only recent activity. Counted via
    // aggregation instead of pulling every order's full documents.
    const companyObjectId = new mongoose.Types.ObjectId(companyId);
    const [mainCounts, extraCounts] = await Promise.all([
      ProductionOrder.aggregate([
        { $match: { company: companyObjectId } },
        { $unwind: '$processes' },
        { $match: { 'processes.assignedTeam': { $ne: null } } },
        { $group: { _id: { team: '$processes.assignedTeam', status: '$processes.status' }, count: { $sum: 1 } } },
      ]),
      ProductionOrder.aggregate([
        { $match: { company: companyObjectId } },
        { $unwind: '$extraUnits' },
        { $unwind: '$extraUnits.processes' },
        { $match: { 'extraUnits.processes.assignedTeam': { $ne: null } } },
        { $group: { _id: { team: '$extraUnits.processes.assignedTeam', status: '$extraUnits.processes.status' }, count: { $sum: 1 } } },
      ]),
    ]);

    const statsByTeam = {};
    for (const { _id, count } of [...mainCounts, ...extraCounts]) {
      const teamId = String(_id.team);
      if (!statsByTeam[teamId]) statsByTeam[teamId] = { total: 0, completed: 0 };
      statsByTeam[teamId].total += count;
      if (_id.status === 'Completed') statsByTeam[teamId].completed += count;
    }

    const teamsWithStats = teams.map(t => ({
      ...t,
      assignmentStats: statsByTeam[String(t._id)] || { total: 0, completed: 0 },
    }));

    res.json({ success: true, data: teamsWithStats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createTeam = async (req, res) => {
  try {
    const { name, supervisor, members, skills, efficiency } = req.body;
    if (!name || !supervisor) {
      return res.status(400).json({ success: false, message: 'name and supervisor are required' });
    }
    const team = await ProductionTeam.create({
      name,
      supervisor,
      members: members || [],
      skills: skills || [],
      efficiency: efficiency || 85,
      company: req.user.companyId,
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: team });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
