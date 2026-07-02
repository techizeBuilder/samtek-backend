import ProductionOrder, { PROCESS_STEPS, PROCESS_TYPE_MAP } from '../models/ProductionOrder.js';
import ProductionTeam from '../models/ProductionTeam.js';
import Sale from '../models/Sale.js';
import QCJob from '../models/QCJob.js';
import notificationService from '../services/notificationService.js';
import RDRequest from '../models/RDRequest.js'
import RDBOM from '../models/RDBOM.js';
import mongoose from 'mongoose';
import { Item } from '../models/Inventory.js'; // Adjust path
import MaterialIssueLog from '../models/MaterialIssueLog.js';



const today = () => new Date().toISOString().split('T')[0];

// ─── ORDER ID GENERATOR ───────────────────────────────────────────────────────
async function generateOrderId(companyId) {
  const year = new Date().getFullYear();
  const count = await ProductionOrder.countDocuments({ company: companyId });
  return `ORD-${year}-${String(count + 1).padStart(3, '0')}`;
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



export const issueMaterialToProduction = async (req, res) => {
  try {
    const { materialCode, quantityToIssue } = req.body;
    const orderId = req.params.id;
    const companyId = req.user.companyId;

    const issueQty = Number(quantityToIssue);

    if (!materialCode || !issueQty || issueQty <= 0) {
      return res.status(400).json({ success: false, message: 'Valid material code and quantity are required.' });
    }

    // 2. Fetch the Order
    const order = await ProductionOrder.findOne({
      _id: orderId,
      company: companyId
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // 3. Find the specific material demand
    const demandIndex = order.materialDemands.findIndex(m => m.materialCode === materialCode);
    if (demandIndex === -1) {
      return res.status(404).json({ success: false, message: 'Material not found in this order.' });
    }
    const demand = order.materialDemands[demandIndex];

    // 4. Application-Level Gatekeepers
    if (demand.status === 'Pending R&D' || demand.status === 'R&D Rejected') {
      return res.status(403).json({ success: false, message: 'Material is locked by R&D.' });
    }

    const remainingToIssue = demand.quantity - (demand.issuedQuantity || 0);
    if (issueQty > remainingToIssue) {
      return res.status(400).json({
        success: false,
        message: `Cannot issue ${issueQty}. Only ${remainingToIssue} more required for this order.`
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 5. ATOMIC INVENTORY DEDUCTION 
    // ─────────────────────────────────────────────────────────────
    // This query says: Find it ONLY if qty is Greater Than or Equal to issueQty
    const inventoryItem = await Item.findOneAndUpdate(
      {
        code: materialCode,
        companyId: companyId,
        qty: { $gte: issueQty } // Database-level lock to prevent negative inventory
      },
      {
        $inc: { qty: -issueQty } // Atomically deduct
      },
      { new: true } 
    );

    // If inventoryItem is null, it means it either doesn't exist, OR qty was too low.
    if (!inventoryItem) {
      // Let's check which one it is so we can give a helpful error message
      const existingItem = await Item.findOne({ code: materialCode, companyId: companyId });

      if (!existingItem) {
        return res.status(404).json({ success: false, message: `Material ${materialCode} not found in Master Inventory.` });
      } else {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock! Store only has ${existingItem.qty} available.`
        });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 6. UPDATE PRODUCTION ORDER 
    // ─────────────────────────────────────────────────────────────
    try {
      const newIssuedQty = (demand.issuedQuantity || 0) + issueQty;
      const newStatus = newIssuedQty >= demand.quantity ? 'Issued' : 'Requested';

      order.materialDemands[demandIndex].issuedQuantity = newIssuedQty;
      order.materialDemands[demandIndex].status = newStatus;

      // Auto-Complete Check
      const allIssued = order.materialDemands.every(m => m.status === 'Issued');
      if (allIssued) {
        order.materialIssued = true;
      }

      // Save order
      await order.save();

      // ─────────────────────────────────────────────────────────────
      // 7. GENERATE AUDIT LOG
      // ─────────────────────────────────────────────────────────────
      await MaterialIssueLog.create({
        productionOrderId: order._id,
        machineCode: order.machineCode,
        materialCode: demand.materialCode,
        materialName: demand.materialName,
        quantityIssued: issueQty,
        unit: demand.unit,
        issuedTo: req.user._id,
        company: companyId
      });

      res.json({
        success: true,
        data: order,
        message: `Successfully issued ${issueQty} ${demand.unit} of ${demand.materialName}.`
      });
    } catch (innerErr) {
      // ─────────────────────────────────────────────────────────────
      // MANUAL ROLLBACK (Compensating Transaction)
      // ─────────────────────────────────────────────────────────────
      // If saving the order or creating the log fails, we MUST refund the inventory
      // to avoid 'ghost inventory' deductions.
      console.error("Post-deduction failure! Refunding inventory...", innerErr);
      await Item.findOneAndUpdate(
        { code: materialCode, companyId: companyId },
        { $inc: { qty: issueQty } } // ADD IT BACK
      );
      throw innerErr; // Rethrow to the outer catch block to send the 500 response
    }

  } catch (err) {
    console.error("Error issuing material:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addMaterialDemand = async (req, res) => {
  try {
    const { materialCode, materialName, quantity, unit } = req.body;

    if (!materialCode || !materialName || !quantity || !unit) {
      return res.status(400).json({ success: false, message: 'All material fields are required' });
    }

    const companyId = req.user.companyId;
    const orderId = req.params.id;

    // Fetch the order first to get machine details for the RD ticket
    const order = await ProductionOrder.findOne({ _id: orderId, company: companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const materialExists = order.materialDemands.find(m => m.materialCode === materialCode);

    // ─────────────────────────────────────────────────────────────
    // FAST LOOKUP: Grab original BOM quantity from the snapshot
    // ─────────────────────────────────────────────────────────────
    const originalBomQty = materialExists && materialExists.bomQuantity !== undefined
      ? materialExists.bomQuantity
      : null;

    // 1. Update or Push the Material as "Pending R&D"
    let updatedOrder;
    if (materialExists) {
      updatedOrder = await ProductionOrder.findOneAndUpdate(
        { _id: orderId, "materialDemands.materialCode": materialCode },
        {
          $set: {
            "materialDemands.$.status": "Pending R&D", // Lock it!
            "materialDemands.$.quantity": Number(quantity),
            "materialDemands.$.unit": unit
            // Note: We DO NOT overwrite bomQuantity here. It stays as the original baseline.
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
              materialCode,
              materialName,
              bomQuantity: null, // Explicitly null because it is Out of BOM
              quantity: Number(quantity),
              unit,
              status: 'Pending R&D'
            }
          }
        },
        { new: true }
      );
    }

    // 2. Automatically generate the R&D Ticket
    // Note: Ensure you have `import RDRequest from '../models/RDRequest.js'` at the top of your file
    await RDRequest.create({
      productionOrderId: order._id,
      machineCode: order.machineCode,
      machineName: order.machineName,
      requestType: 'Material Change', // Tells R&D this is a micro-request
      materialChangeDetails: {
        materialCode,
        materialName,
        bomQuantity: originalBomQty, // ── PASSES THE FAST-LOOKUP BASELINE TO R&D ──
        requestedQuantity: Number(quantity),
        unit
      },
      company: companyId
    });

    res.json({ success: true, data: updatedOrder, message: 'Demand sent to R&D for approval.' });
  } catch (err) {
    console.error("Error in addMaterialDemand:", err);
    res.status(500).json({ success: false, message: err.message });
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

export const assignTeam = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const { teamId } = req.body;
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    order.processes[idx].assignedTeam = teamId || null;
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const startProcess = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    // Gate: previous step must be completed
    if (idx > 0 && order.processes[idx - 1].status !== 'Completed') {
      return res.status(400).json({ success: false, message: `Cannot start ${PROCESS_STEPS[idx]}: ${PROCESS_STEPS[idx - 1]} not yet completed` });
    }
    order.processes[idx].status = 'In Progress';
    order.processes[idx].startDate = today();
    order.status = 'In Progress';
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const markProcessComplete = async (req, res) => {
  try {
    const idx = getStepIndex(req, res);
    if (idx === -1) return;
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    order.processes[idx].status = 'QC Pending';
    order.processes[idx].endDate = today();
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
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
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    order.processes[idx].status = 'Completed';
    order.processes[idx].qcStatus = 'Approved';
    order.processes[idx].qcBy = qcBy;
    order.processes[idx].qcDate = today();
    // Check if all processes completed
    if (order.processes.every(p => p.status === 'Completed')) {
      order.status = 'Completed';
    }
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');

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
          linkedSale.storeQCStatus = 'Production Completed';
          await linkedSale.save();
          console.log(`🏪 [Production Completed] storeQCStatus='Production Completed' for Sale ${linkedSale._id}`);
        } else {
          console.warn(`⚠️ [Production Completed] Could not find linked Sale for ProductionOrder ${order.orderId}`);
        }
      } catch (saleUpdateErr) {
        console.error('❌ Error updating Sale storeQCStatus on production completion:', saleUpdateErr);
      }

      // 🏭 Auto-create QC Job for completed production order
      try {
        const existingQC = await QCJob.findOne({
          source: order.source === 'QC_Rejected' ? 'QC_Rejected' : 'Production',
          sourceRefId: order.orderId,
          company: order.company
        });

        if (!existingQC) {
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
          const qcJobId = `QC-${year}-${String(nextNumber).padStart(4, '0')}`;

          let qcCategory = 'Finished Good'; // default for production
          try {
            const { Item } = await import('../models/Inventory.js');
            const inventoryItem = await Item.findOne({
              $or: [
                { code: order.machineCode },
                { name: order.machineName }
              ],
              companyId: order.company
            });
            if (inventoryItem && inventoryItem.category) {
              qcCategory = inventoryItem.category;
            }
          } catch (itemErr) {
            console.error('Error looking up inventory item for category:', itemErr);
          }

          const qcJob = await QCJob.create({
            qcJobId,
            source: order.source === 'QC_Rejected' ? 'QC_Rejected' : 'Production',
            sourceRefId: order.orderId,
            sourceDepartment: 'Production',
            sentBy: qcBy || 'Production Dept',
            itemName: order.machineName,
            itemCode: order.machineCode,
            category: qcCategory,
            quantity: 1,
            unit: 'pcs',
            receivedDate: today(),
            status: 'Pending',
            saleId: order.saleId,
            company: order.company,
            createdBy: req.user._id,
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
        }
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
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const proc = order.processes[idx];
    proc.status = 'In Progress';
    proc.qcStatus = 'Rejected';
    proc.qcBy = qcBy;
    proc.qcDate = today();
    proc.notes = reason || proc.notes;
    proc.reworks.push({ date: today(), reason: reason || '', rejectedBy: qcBy });
    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');
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
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    order.processes[idx].notes = notes || '';
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
