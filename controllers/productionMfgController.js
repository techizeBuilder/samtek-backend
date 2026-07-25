import ProductionOrder, { PROCESS_STEPS, PROCESS_TYPE_MAP, buildProcessSteps } from '../models/ProductionOrder.js';
import ProductionTeam from '../models/ProductionTeam.js';
import Sale from '../models/Sale.js';
import QCJob from '../models/QCJob.js';
import notificationService from '../services/notificationService.js';
import RDRequest from '../models/RDRequest.js'
import RDBOM from '../models/RDBOM.js';
import RDMachine from '../models/RDMachine.js';
import mongoose from 'mongoose';
import { Item } from '../models/Inventory.js'; // Adjust path
import MaterialIssueLog from '../models/MaterialIssueLog.js';
import { recalculateItemPricing } from '../services/itemPricingService.js';

import PDFDocument from 'pdfkit';


import MaterialReturnLog from '../models/MaterialReturnLog.js';




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
    source: order.source === 'QC_Rejected' ? 'QC_Rejected' : 'Production',
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
    source: order.source === 'QC_Rejected' ? 'QC_Rejected' : 'Production',
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
    notes: `Automatically created from completed Production Order: ${order.orderId}`
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

export const getOrders = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    console.log(`🔍 Fetching Production Orders for Company: ${companyId}`);

    // Find orders for this company, using lean() for faster read and easier debugging
    const orders = await ProductionOrder.find({
      company: companyId
    })
      .populate('processes.assignedTeam', 'name supervisor members')
      .populate('extraUnits.processes.assignedTeam', 'name supervisor members')
      .sort({ createdAt: -1 })
      .lean();

    console.log(`✅ Found ${orders.length} orders for company ${companyId}`);
    res.json({ success: true, data: orders });
  } catch (err) {
    console.error('❌ Error in getOrders:', err);
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
    const order = await ProductionOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, reworkDecision: 'Repair' },
      { 'repair.status': 'In Progress', 'repair.assignedTo': assignedTo || '' },
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
    const { materialCode, materialName, quantity, unit } = req.body;

    if (!materialCode || !materialName || !quantity || !unit) {
      return res.status(400).json({ success: false, message: 'All material fields are required' });
    }

    const companyId = req.user.companyId;
    const orderId = req.params.id;

    const order = await ProductionOrder.findOne({ _id: orderId, company: companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const materialExists = order.materialDemands.find(m => m.materialCode === materialCode);

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
        { _id: orderId, "materialDemands.materialCode": materialCode },
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
              materialCode, materialName, bomQuantity: null,
              quantity: Number(quantity), unit, status: 'Pending R&D'
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
        materialCode,
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
      // Check for page overflow limits dynamically
      if (currentY > 700) {
        doc.addPage();
        currentY = 50; // Reset height position for additional pages
      }

      // Draw border line separator frame
      doc.moveTo(50, currentY + 22).lineTo(562, currentY + 22).strokeColor('#f1f5f9').lineWidth(1).stroke();

      // Populate Item Text Strings
      doc.fillColor('#334155').fontSize(9).font('Helvetica');
      doc.text(item.materialCode, 60, currentY + 7, { width: 80 });
      doc.text(item.materialName, 150, currentY + 7, { width: 160 });
      doc.text(`${item.quantity} ${item.unit}`, 320, currentY + 7, { width: 50, align: 'center' });
      doc.text(`${item.transferredQuantity} ${item.unit}`, 380, currentY + 7, { width: 65, align: 'center' });
      doc.text(`${item.issuedQuantity} ${item.unit}`, 455, currentY + 7, { width: 50, align: 'center' });

      // Format styling explicitly for status string layout values
      const statusColor = item.status === 'Issued' ? '#16a34a' : '#475569';
      doc.fillColor(statusColor).font('Helvetica-Bold');
      doc.text(item.status, 510, currentY + 7, { width: 45, align: 'right' });

      currentY += 22;
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
    const { qcBy } = req.body;
    if (!qcBy) return res.status(400).json({ success: false, message: 'qcBy is required' });
    const unitNumber = getUnitNumber(req);
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const procs = getUnitProcesses(order, unitNumber);
    if (!procs) return res.status(400).json({ success: false, message: 'Invalid unit number' });
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

      // 🏗️ Mark RDMachine as built + recalculate its Item's manufacturing
      // cost from the BOM (runs on every completion so cost stays fresh)
      try {
        const rdMachine = await RDMachine.findOne({ code: order.machineCode, company: order.company });
        if (rdMachine && !rdMachine.firstBuiltAt) {
          rdMachine.firstBuiltAt = new Date();
          await rdMachine.save();
        }

        const mfgItem = await Item.findOne({
          $or: [{ code: order.machineCode }, { name: order.machineName }],
          companyId: order.company
        });
        if (mfgItem && mfgItem.internalManufacturing) {
          await recalculateItemPricing(mfgItem);
        }
      } catch (pricingErr) {
        console.error('❌ Error recalculating item pricing on production completion:', pricingErr);
      }

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
    const teams = await ProductionTeam.find({ company: req.user.companyId, isActive: true }).sort({ createdAt: 1 });
    res.json({ success: true, data: teams });
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
