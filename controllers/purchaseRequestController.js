import PurchaseRequest from '../models/PurchaseRequest.js';
import Sale from '../models/Sale.js';
import Order from '../models/Order.js';
import QCJob from '../models/QCJob.js';
import fs from 'fs';
import notificationService from '../services/notificationService.js';

// Generate a unique requestId safely (avoids E11000 duplicate key errors)
async function generateUniqueRequestId() {
  let attempts = 0;
  while (attempts < 20) {
    const count = await PurchaseRequest.countDocuments({});
    const candidate = `PR${String(count + 1 + attempts).padStart(3, '0')}`;
    const exists = await PurchaseRequest.findOne({ requestId: candidate }).lean();
    if (!exists) return candidate;
    attempts++;
  }
  // Fallback: timestamp-based ID
  return `PR-${Date.now().toString().slice(-6)}`;
}

// Get all purchase requests for a company
export const getPurchaseRequests = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'User company is not configured' });
    }

    const isStoreUser = req.user.role === 'Store Head' || req.user.role === 'Store Employee';

    // --- Auto-sync existing matching Sales to Purchase Requests ---
    try {
      const matchingSales = await Sale.find({
        companyId,
        isAvailableInInventory: 'Not Available',
        productType: 'Purchased (Trading Product)'
      }).populate('order');

      for (const sale of matchingSales) {
        const sourceRefId = sale.invoiceNumber || sale._id.toString();
        
        const existingReq = await PurchaseRequest.findOne({
          companyId,
          itemId: sourceRefId
        });

        if (!existingReq) {
          const firstItem = sale.items && sale.items.length > 0 ? sale.items[0].productName : 'Order Items';
          const productName = sale.items && sale.items.length > 1 ? `${firstItem} + ${sale.items.length - 1} more` : firstItem;
          
          const requestId = await generateUniqueRequestId();

          await PurchaseRequest.create({
            requestId,
            productName,
            quantity: sale.items?.reduce((acc, item) => acc + (item.quantity || 0), 0) || 1,
            requestFromDepartment: 'Store',
            source: 'Store',
            storeApproved: true, // Store-originated requests go directly to Purchase
            priority: sale.order?.priority || 'Medium',
            companyId,
            storeOrderId: sale.order?._id || sale._id,
            itemId: sourceRefId
          });
          console.log(`Auto-synced existing sale to Purchase Request: ${requestId}`);
        }
      }
    } catch (syncError) {
      console.error('Error during auto-sync of Purchase Requests:', syncError);
    }
    // -------------------------------------------------------------

    // Build query based on role:
    // Store users: see their own (Store-sourced) requests PLUS Production-sourced (pending their approval)
    // Purchase/other users: see only Store-sourced OR storeApproved Production requests
    let query = { companyId };
    if (isStoreUser) {
      // Store sees all requests for their company (including Store, Production, QC, and old/migrated requests)
      // No extra source-based filtering is needed
    } else {
      // Purchase dept: see Store-sourced (source is 'Store' OR missing/null) OR Production/QC that Store has approved
      query.$or = [
        { source: 'Store' },
        { source: null },
        { source: { $exists: false } },
        { source: { $in: ['Production', 'QC'] }, storeApproved: true }
      ];
    }

    const requests = await PurchaseRequest.find(query)
      .populate({
        path: 'purchaseOrder',
        populate: { path: 'supplier' }
      })
      .sort({ createdAt: -1 });

    // --- Self-healing sync: Auto-update status to Ordered if a PO is linked and status is Pending/Approved ---
    let updatedAny = false;
    for (const reqObj of requests) {
      if (reqObj.purchaseOrder && (reqObj.status === 'Pending' || reqObj.status === 'Approved')) {
        reqObj.status = 'Ordered';
        await reqObj.save();
        updatedAny = true;
        console.log(`[Self-healing] Auto-synced request status to Ordered for ${reqObj.requestId} because PO exists`);
      }
    }
    
    // Re-fetch if any requests were modified to have correct populated data and status in response
    let finalRequests = requests;
    if (updatedAny) {
      finalRequests = await PurchaseRequest.find(query)
        .populate({
          path: 'purchaseOrder',
          populate: { path: 'supplier' }
        })
        .sort({ createdAt: -1 });
    }

    res.status(200).json({ success: true, data: finalRequests });
  } catch (error) {
    console.error('Error fetching purchase requests:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Create a new purchase request
export const createPurchaseRequest = async (req, res) => {
  try {
    const { productName, quantity, requestFromDepartment, priority, storeOrderId, itemId, source, unit, materialCode } = req.body;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({ success: false, message: 'User company is not configured' });
    }

    const isStoreUser = req.user.role === 'Store Head' || req.user.role === 'Store Employee';

    // Determine source: explicit source field, or infer from role
    const resolvedSource = source || (isStoreUser ? 'Store' : 'Production');

    // Store-originated requests go directly to Purchase (storeApproved=true)
    // Production/QC-originated requests need Store approval first (storeApproved=false)
    const resolvedStoreApproved = resolvedSource === 'Store';

    // Generate Request ID globally to prevent unique index duplicates across companies
    const requestId = await generateUniqueRequestId();

    const newRequest = await PurchaseRequest.create({
      requestId,
      productName,
      quantity,
      requestFromDepartment: isStoreUser ? 'Store' : (requestFromDepartment || 'Production'),
      priority: priority || 'Medium',
      companyId,
      storeOrderId,
      itemId,
      source: resolvedSource,
      storeApproved: resolvedStoreApproved,
      unit: unit || null,
      materialCode: materialCode || null
    });

    res.status(201).json({ success: true, data: newRequest });

    // 🔔 Notify Accounts about new purchase request
    try {
      await notificationService.triggerStoreNotification({
        action: 'purchase_request_created',
        data: { requestId: newRequest.requestId, productName: newRequest.productName, priority: newRequest.priority },
        targetCompanyId: companyId,
      });
    } catch (e) { console.error('Purchase request notification error:', e); }
  } catch (error) {
    console.error('Error creating purchase request:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Store approves a Production-raised demand → makes it visible to Purchase dept
export const storeApproveRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    // Only Store users can approve
    const isStoreUser = req.user.role === 'Store Head' || req.user.role === 'Store Employee';
    if (!isStoreUser) {
      return res.status(403).json({ success: false, message: 'Only Store users can approve material demands' });
    }

    const request = await PurchaseRequest.findOne({ _id: id, companyId });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.storeApproved) {
      return res.status(400).json({ success: false, message: 'Request is already approved' });
    }

    request.storeApproved = true;
    request.storeApprovedAt = new Date();
    await request.save();

    console.log(`✅ Store approved Production request ${request.requestId} → forwarded to Purchase dept`);
    res.status(200).json({ success: true, data: request, message: 'Request approved and forwarded to Purchase department' });
  } catch (error) {
    console.error('Error approving purchase request:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

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

// Update purchase request status
export const updatePurchaseRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Enforce that Store Head / Store Employee can only change status to "Received"
    if (req.user.role === 'Store Head' || req.user.role === 'Store Employee') {
      if (status !== 'Received') {
        return res.status(403).json({ success: false, message: 'Store users can only change status to Received' });
      }
    }

    const request = await PurchaseRequest.findById(id).populate('purchaseOrder');
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    // ── Validate mandatory receive fields ──────────────────────────────────────
    if (status === 'Received' && request.status !== 'Received') {
      const serialNumber   = req.body.serialNumber?.trim();
      const warrantyPeriod = req.body.warrantyPeriod;
      const warrantyCard   = req.file; // uploaded via multer

      const missing = [];
      if (!serialNumber)        missing.push('Serial Number');
      if (!warrantyPeriod)      missing.push('Warranty Period (months)');
      if (!warrantyCard)        missing.push('Warranty Card (image or PDF)');

      if (missing.length > 0) {
        // If multer already saved a file but other fields are missing, clean it up
        if (warrantyCard) {
          try { fs.unlinkSync(warrantyCard.path); } catch (_) {}
        }
        return res.status(400).json({
          success: false,
          message: `Cannot mark as Received. The following are required: ${missing.join(', ')}`
        });
      }

      // Save receive-specific data on the purchase request
      request.serialNumber    = serialNumber;
      request.warrantyPeriod  = Number(warrantyPeriod);
      request.warrantyCardUrl = `/uploads/warranty-cards/${warrantyCard.filename}`;
      request.receivedAt      = new Date();
    }
    // ──────────────────────────────────────────────────────────────────────────

    const oldStatus = request.status;
    request.status = status;
    await request.save();

    // Trigger QC Job & Purchase Invoice creation on 'Received' status transition
    if (status === 'Received' && oldStatus !== 'Received') {

      // ── Update matching Inventory item with serial + warranty info ───────────
      try {
        const { Item } = await import('../models/Inventory.js');

        // Try to match by name (best-effort; productName was copied from the item)
        const inventoryItem = await Item.findOne({
          name: { $regex: new RegExp(`^${request.productName.trim()}$`, 'i') },
          companyId: request.companyId
        });

        if (inventoryItem) {
          inventoryItem.serialNumber               = request.serialNumber;
          inventoryItem.warranty.period            = request.warrantyPeriod;
          inventoryItem.warranty.cardUrl           = request.warrantyCardUrl;
          inventoryItem.warranty.cardUploadedAt    = new Date();
          inventoryItem.receivedFromPurchaseRequest = request._id;
          await inventoryItem.save();
          console.log(`✅ Inventory item "${inventoryItem.name}" updated with serial & warranty info`);
        } else {
          console.warn(`⚠️  No matching inventory item found for "${request.productName}" – skipping inventory update`);
        }
      } catch (invErr) {
        console.error('❌ Error updating inventory item on receive:', invErr);
      }
      // ─────────────────────────────────────────────────────────────────────────

      // 1. Generate QC Job
      try {
        const sourceRefId = request.purchaseOrder?.purchaseOrderNumber || request.requestId;
        
        // Check if a QC job for this sourceRefId already exists
        const existingQC = await QCJob.findOne({
          source: 'Purchase',
          sourceRefId: sourceRefId,
          company: request.companyId
        });

        if (!existingQC) {
          const qcJobId = await generateQCJobId();
          
          await QCJob.create({
            qcJobId,
            source: 'Purchase',
            sourceRefId: sourceRefId,
            sourceDepartment: 'Store',
            sentBy: req.user.fullName || req.user.username || 'Store Dept',
            itemName: request.productName,
            itemCode: request.itemId || request.requestId,
            category: 'Raw Material', // purchase items are typically raw materials/trading goods
            quantity: request.quantity || 1,
            unit: 'pcs',
            receivedDate: today(),
            status: 'Pending',
            company: request.companyId,
            createdBy: req.user._id,
            notes: `Automatically created from Store Purchase Requisition: ${request.requestId}`
          });
          console.log(`✅ QC Job ${qcJobId} automatically created for Purchase Request ${request.requestId}`);
        }
      } catch (qcError) {
        console.error('❌ Error creating QC job from Purchase Request:', qcError);
      }

      // 2. Generate Purchase Invoice ONLY if one doesn't already exist for this PO
      //    (Invoice is now created at PO generation time via RFQ flow — avoid duplicate)
      try {
        const { createAutoPurchaseInvoice } = await import('./purchaseInvoiceController.js');
        const PurchaseInvoice = (await import('../models/PurchaseInvoice.js')).default;

        // Check if invoice already exists linked to this PO's vendor + reference
        let invoiceAlreadyExists = false;
        if (request.purchaseOrder) {
          const poNumber = request.purchaseOrder?.purchaseOrderNumber || '';
          const vendorId = request.purchaseOrder?.supplier?._id || request.purchaseOrder?.supplier;
          if (vendorId && poNumber) {
            const existingInvoice = await PurchaseInvoice.findOne({
              vendor: vendorId,
              notes: { $regex: request.requestId, $options: 'i' }
            });
            if (existingInvoice) {
              invoiceAlreadyExists = true;
              console.log(`ℹ️ [Purchase Receipt] Invoice already exists for ${request.requestId} — skipping duplicate creation`);
            }
          }
        }

        if (!invoiceAlreadyExists) {
          await createAutoPurchaseInvoice(request, req.user);
          console.log(`✅ [Purchase Receipt] Purchase Invoice created for request: ${request.requestId}`);
        }
      } catch (invoiceError) {
        console.error('❌ Error creating purchase invoice on request receipt:', invoiceError);
      }
    }

    res.status(200).json({ success: true, data: request });
  } catch (error) {
    console.error('Error updating purchase request:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
