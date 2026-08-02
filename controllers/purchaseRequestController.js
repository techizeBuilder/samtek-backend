import PurchaseRequest from '../models/PurchaseRequest.js';
import StagedPurchase from '../models/StagedPurchase.js';
import Sale from '../models/Sale.js';
import Order from '../models/Order.js';
import QCJob from '../models/QCJob.js';

import fs from 'fs';
import path from 'path';
import notificationService from '../services/notificationService.js';
import { Item } from '../models/Inventory.js';

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
    // Multi-item aware: sales with per-item flow create one PR per item that
    // is routed 'Goes to Purchase' (keyed by saleItemId); legacy sales keep
    // the old whole-sale behavior.
    try {
      const matchingSales = await Sale.find({
        companyId,
        $or: [
          { isAvailableInInventory: 'Not Available', productType: 'Purchased (Trading Product)' },
          { 'items.storeQCStatus': 'Goes to Purchase' }
        ]
      }).populate('order');

      for (const sale of matchingSales) {
        const sourceRefIdBase = sale.invoiceNumber || sale._id.toString();
        const perItemFlow = (sale.items || []).some(it =>
          it.storeQCStatus || it.isAvailableInInventory || it.productType);

        if (perItemFlow) {
          for (const it of sale.items || []) {
            if (it.storeQCStatus !== 'Goes to Purchase') continue;
            const existingItemReq = await PurchaseRequest.findOne({ companyId, saleItemId: it._id });
            if (existingItemReq) continue;

            const requestId = await generateUniqueRequestId();
            await PurchaseRequest.create({
              requestId,
              productName: it.productName,
              quantity: it.quantity || 1,
              requestFromDepartment: 'Store',
              source: 'Store',
              storeApproved: true,
              priority: sale.order?.priority || 'Medium',
              companyId,
              storeOrderId: sale.order?._id || sale._id,
              itemId: `${sourceRefIdBase}#${it._id.toString()}`,
              saleItemId: it._id
            });
            console.log(`Auto-synced sale item "${it.productName}" to Purchase Request: ${requestId}`);
          }
          continue;
        }

        // Legacy whole-sale sync
        if (sale.isAvailableInInventory !== 'Not Available' || sale.productType !== 'Purchased (Trading Product)') continue;
        const existingReq = await PurchaseRequest.findOne({ companyId, itemId: sourceRefIdBase });

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
            itemId: sourceRefIdBase
          });
          console.log(`Auto-synced existing sale to Purchase Request: ${requestId}`);
        }
      }
    } catch (syncError) {
      console.error('Error during auto-sync of Purchase Requests:', syncError);
    }
    // -------------------------------------------------------------

    let query = { companyId };
    if (!isStoreUser) {
      // Purchase dept: see Store-sourced or Production/QC that Store has approved
      query.$or = [
        { source: 'Store' },
        { source: null },
        { source: { $exists: false } },
        { source: { $in: ['Production', 'QC'] }, storeApproved: true }
      ];
    }
    // RFQ Management only ever needs the still-actionable (Pending/Approved)
    // subset, not the full historical archive Purchase Request browses —
    // scope at the DB query level via ?status=Pending,Approved instead of
    // fetching everything and filtering client-side.
    if (req.query.status) {
      const statuses = req.query.status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length) query.status = { $in: statuses };
    }

    const requests = await PurchaseRequest.find(query)
      .populate({ path: 'purchaseOrder', populate: { path: 'supplier' } })
      .sort({ createdAt: -1 });

    // --- Self-healing sync ---
    let updatedAny = false;
    for (const reqObj of requests) {
      if (reqObj.purchaseOrder && (reqObj.status === 'Pending' || reqObj.status === 'Approved')) {
        reqObj.status = 'Ordered';
        await reqObj.save();
        updatedAny = true;
      }
    }

    let finalRequests = requests;
    if (updatedAny) {
      finalRequests = await PurchaseRequest.find(query)
        .populate({ path: 'purchaseOrder', populate: { path: 'supplier' } })
        .sort({ createdAt: -1 });
    }

    // Auto-sync + self-healing above still need to see (and fix) every
    // purchase request, so that part isn't paginated — but search/pagination
    // ARE applied here, before the per-row Master Item lookup below, so that
    // expensive N+1 enrichment only ever runs for the current page's rows,
    // not every purchase request the company has ever filed.
    const { page = 1, limit = 20, search } = req.query;
    let filteredRequests = finalRequests;
    if (search) {
      const q = search.toLowerCase();
      filteredRequests = filteredRequests.filter(r =>
        (r.productName || '').toLowerCase().includes(q) ||
        (r.requestId || '').toLowerCase().includes(q)
      );
    }
    const total = filteredRequests.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const pageRequests = filteredRequests.slice(skip, skip + parseInt(limit));

    // ─────────────────────────────────────────────────────────────
    // NEW: Attach Master Inventory Item (R&D Specs) to each PR
    // ─────────────────────────────────────────────────────────────
    const enrichedRequests = await Promise.all(pageRequests.map(async (reqObj) => {
      const pr = reqObj.toObject();

      // Attempt to find the Master Item to attach R&D Specs
      const masterItem = await Item.findOne({
        companyId,
        $or: [
          { code: pr.itemId },
          { name: { $regex: new RegExp(`^${pr.productName}$`, 'i') } }
        ]
      }).select('name code specifications warranty unit unitType purchaseUnit purchaseUnitType');

      if (masterItem) {
        pr.item = masterItem; // Attaches to PR so the frontend UI can read it
      }

      return pr;
    }));

    res.status(200).json({
      success: true,
      data: enrichedRequests,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Error fetching purchase requests:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/purchase-requests/staged
export const getStagedPurchaseRequests = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({ success: false, message: 'User company is not configured' });
    }

    // Fetch all staged items for this company, sorted by newest first
    const stagedItems = await StagedPurchase.find({ companyId }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: stagedItems
    });
  } catch (error) {
    console.error('Error fetching staged purchase requests:', error);
    res.status(500).json({ success: false, message: 'Server Error fetching staged items.' });
  }
};

// POST /api/purchase-requests/bulk-purchase
export const createBulkPurchaseRequests = async (req, res) => {
  try {
    const { items, stagedIds } = req.body;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({ success: false, message: 'User company is not configured' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No procurement items provided.' });
    }

    // ─────────────────────────────────────────────────────────────
    // 1. GLOBAL BULK R&D COMPLIANCE CHECK (On Consolidated List)
    // ─────────────────────────────────────────────────────────────
    const validationErrors = [];
    for (const item of items) {
      const searchCriteria = [{ name: { $regex: new RegExp(`^${item.productName.trim()}$`, 'i') } }];
      if (item.materialCode) searchCriteria.push({ code: item.materialCode });
      if (item.itemId && item.itemId.toString().match(/^[0-9a-fA-F]{24}$/)) {
        searchCriteria.push({ _id: item.itemId });
      }

      const masterItem = await Item.findOne({ companyId, $or: searchCriteria });
      if (!masterItem) {
        validationErrors.push(`Product "${item.productName}" does not exist in Master Inventory.`);
        continue;
      }
      if (masterItem.purchase === false) {
        validationErrors.push(`"${masterItem.name}" is flagged for Internal Manufacturing only.`);
        continue;
      }
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({ success: false, message: 'R&D Restriction Failure', errors: validationErrors });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. GENERATE COMBINED COMPLIANT REQUEST RECORDS
    // ─────────────────────────────────────────────────────────────
    const isStoreUser = req.user.role === 'Store Head' || req.user.role === 'Store Employee';
    const createdRequests = [];

    for (const item of items) {
      const resolvedSource = item.source || (isStoreUser ? 'Store' : 'Production');
      const resolvedStoreApproved = resolvedSource === 'Store';
      const requestId = await generateUniqueRequestId();

      const newRequest = await PurchaseRequest.create({
        requestId,
        productName: item.productName,
        quantity: Number(item.quantity),
        requestFromDepartment: isStoreUser ? 'Store' : 'Production',
        priority: item.priority || 'Medium',
        companyId,
        storeOrderId: null, // Left null because this represents a consolidated cross-order buy
        itemId: item.itemId || null,
        source: resolvedSource,
        storeApproved: resolvedStoreApproved,
        unit: item.unit || null,
        materialCode: item.materialCode || null
      });

      createdRequests.push(newRequest);

      try {
        await notificationService.triggerStoreNotification({
          action: 'purchase_request_created',
          data: { requestId: newRequest.requestId, productName: newRequest.productName, priority: newRequest.priority },
          targetCompanyId: companyId,
        });
      } catch (e) {
        console.error(`Bulk notification dispatch error:`, e.message);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. PURGE SPENT STAGING REQS FROM OTHER COLLECTION BY REQ IDS
    // ─────────────────────────────────────────────────────────────
    if (stagedIds && Array.isArray(stagedIds) && stagedIds.length > 0) {
      await StagedPurchase.deleteMany({
        companyId,
        _id: { $in: stagedIds }
      });
    }

    res.status(201).json({
      success: true,
      message: `Successfully generated ${createdRequests.length} clean combined purchase requests. Staging table cleared.`,
      data: createdRequests
    });

  } catch (error) {
    console.error('Error handling bulk purchase creation:', error);
    res.status(500).json({ success: false, message: 'Server Error handling bulk purchase creation.' });
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

    // ─────────────────────────────────────────────────────────────
    // STRICT R&D COMPLIANCE CHECK (The Gatekeeper)
    // ─────────────────────────────────────────────────────────────
    try {
      const searchCriteria = [{ name: { $regex: new RegExp(`^${productName.trim()}$`, 'i') } }];
      if (itemId) searchCriteria.push({ code: itemId });
      if (materialCode) searchCriteria.push({ code: materialCode });

      // If itemId is a valid MongoDB ObjectId, check by _id too
      if (itemId && itemId.match(/^[0-9a-fA-F]{24}$/)) {
        searchCriteria.push({ _id: itemId });
      }

      const masterItem = await Item.findOne({
        companyId,
        $or: searchCriteria
      });

      // LOCK 1: Block completely unknown items (Forces users to use Master Inventory)
      if (!masterItem) {
        return res.status(400).json({
          success: false,
          message: `R&D Restriction: Product "${productName}" does not exist in the Master Inventory. R&D must define and approve an item before it can be purchased.`
        });
      }

      // LOCK 2: Block items meant only for internal manufacturing
      if (masterItem.purchase === false) {
        return res.status(403).json({
          success: false,
          message: `R&D Restriction: "${masterItem.name}" is marked for Internal Manufacturing only and is NOT authorized for vendor purchasing.`
        });
      }
    } catch (validationError) {
      console.warn('Error during R&D purchase validation:', validationError.message);
      return res.status(500).json({
        success: false,
        message: 'Internal error validating product against Master Inventory.'
      });
    }
    // ─────────────────────────────────────────────────────────────

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
    } catch (e) {
      console.error('Purchase request notification error:', e);
    }

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

// Store rejects a Production-raised demand
export const storeRejectRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const companyId = req.user.companyId;

    // Only Store users can reject
    const isStoreUser = req.user.role === 'Store Head' || req.user.role === 'Store Employee';
    if (!isStoreUser) {
      return res.status(403).json({ success: false, message: 'Only Store users can reject material demands' });
    }

    const request = await PurchaseRequest.findOne({ _id: id, companyId });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.storeApproved) {
      return res.status(400).json({ success: false, message: 'Cannot reject an already approved request' });
    }

    if (request.status === 'Rejected') {
      return res.status(400).json({ success: false, message: 'Request is already rejected' });
    }

    request.status = 'Rejected';
    request.rejectedAt = new Date();
    request.rejectionReason = reason || 'Rejected by Store';
    await request.save();

    console.log(`❌ Store rejected Production request ${request.requestId}`);
    res.status(200).json({ success: true, data: request, message: 'Request rejected successfully' });
  } catch (error) {
    console.error('Error rejecting purchase request:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Check Inventory availability for a Purchase Request item
export const checkInventoryForPR = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const request = await PurchaseRequest.findOne({ _id: id, companyId }).lean();
    if (!request) {
      return res.status(404).json({ success: false, message: 'Purchase request not found' });
    }

    const { productName, materialCode, quantity: requestedQty } = request;

    // Build search conditions: match by code (exact) OR name (case-insensitive partial)
    const orConditions = [];
    if (materialCode && materialCode.trim()) {
      orConditions.push({ code: { $regex: new RegExp(`^${materialCode.trim()}$`, 'i') } });
    }
    if (productName && productName.trim()) {
      orConditions.push({ name: { $regex: new RegExp(productName.trim(), 'i') } });
    }

    if (orConditions.length === 0) {
      return res.status(400).json({ success: false, message: 'No product name or material code available to search inventory' });
    }

    // Search in inventory (company-scoped)
    const matches = await Item.find({
      $and: [
        { $or: orConditions },
        { $or: [{ companyId }, { store: companyId.toString() }] }
      ]
    }).select('name code qty unit category minStock importance').lean();

    if (matches.length === 0) {
      return res.json({
        success: true,
        found: false,
        message: `No item found in inventory matching "${productName}"${materialCode ? ` or code "${materialCode}"` : ''}.`,
        items: []
      });
    }

    // Enrich each match with availability info
    const enriched = matches.map(item => {
      const available = item.qty || 0;
      const needed = requestedQty || 1;
      const isSufficient = available >= needed;
      const isLow = available > 0 && available < needed;
      const isOut = available === 0;

      return {
        _id: item._id,
        name: item.name,
        code: item.code,
        currentQty: available,
        requestedQty: needed,
        unit: item.unit || 'pcs',
        category: item.category,
        minStock: item.minStock || 0,
        importance: item.importance,
        status: isSufficient ? 'sufficient' : isLow ? 'low' : 'out_of_stock',
        statusLabel: isSufficient ? 'Sufficient Stock' : isLow ? 'Insufficient Stock' : 'Out of Stock',
        canFulfill: isSufficient
      };
    });

    const anySufficient = enriched.some(i => i.canFulfill);

    return res.json({
      success: true,
      found: true,
      canFulfill: anySufficient,
      message: anySufficient
        ? `Item found in inventory with sufficient stock.`
        : `Item found in inventory but stock is insufficient for requested quantity (${requestedQty}).`,
      items: enriched
    });
  } catch (error) {
    console.error('Error checking inventory for PR:', error);
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
      const serialNumber = req.body.serialNumber?.trim();
      const warrantyPeriod = req.body.warrantyPeriod;
      const warrantyCard = req.file; // uploaded via multer

      const missing = [];
      if (!serialNumber) missing.push('Serial Number');
      // 0 is a valid warranty (no warranty) — only missing/negative is invalid
      if (warrantyPeriod === undefined || warrantyPeriod === '' || Number(warrantyPeriod) < 0) missing.push('Warranty Period (months)');
      // Warranty Card is required only when there IS a warranty (> 0 months)
      if (Number(warrantyPeriod) > 0 && !warrantyCard) missing.push('Warranty Card (image or PDF)');

      if (missing.length > 0) {
        // If multer already saved a file but other fields are missing, clean it up
        if (warrantyCard) {
          try { fs.unlinkSync(warrantyCard.path); } catch (_) { }
        }
        return res.status(400).json({
          success: false,
          message: `Cannot mark as Received. The following are required: ${missing.join(', ')}`
        });
      }

      // ── Unit conversion: order was placed in a purchase unit, Store must
      // convert the received qty back to the item's base (storage) unit ──────
      if (request.purchaseUnit && request.purchaseQuantity) {
        const receivedQuantity = Number(req.body.receivedQuantity);
        const conversionFactor = Number(req.body.conversionFactor); // purchaseUnit per 1 base unit

        if (!(receivedQuantity > 0) || !(conversionFactor > 0)) {
          if (warrantyCard) {
            try { fs.unlinkSync(warrantyCard.path); } catch (_) { }
          }
          return res.status(400).json({
            success: false,
            message: `Cannot mark as Received. Unit conversion is required: enter the Received Quantity (in ${request.purchaseUnit}) and how many ${request.purchaseUnit} equal 1 storage unit.`
          });
        }

        request.receivedQuantity = receivedQuantity;
        request.conversionFactor = conversionFactor;
        request.convertedQuantity = Math.round((receivedQuantity / conversionFactor) * 1000) / 1000;
      }

      // Save receive-specific data on the purchase request
      request.serialNumber = serialNumber;
      request.warrantyPeriod = Number(warrantyPeriod);
      if (warrantyCard) request.warrantyCardUrl = `/uploads/warranty-cards/${warrantyCard.filename}`;
      request.receivedAt = new Date();
    }
    // ──────────────────────────────────────────────────────────────────────────

    const oldStatus = request.status;
    request.status = status;
    await request.save();

    // 🔔 Notify Store team about status change
    if (oldStatus !== status) {
      try {
        await notificationService.triggerStoreNotification({
          action: 'purchase_request_status_changed',
          data: {
            requestId: request.requestId,
            productName: request.productName,
            newStatus: status,
            oldStatus,
            remarks: `Status updated from ${oldStatus} to ${status}`,
          },
          targetCompanyId: request.companyId,
        });
      } catch (e) { console.error('PR status change store notification error:', e); }
    }

    // Trigger QC Job & Purchase Invoice creation on 'Received' status transition
    if (status === 'Received' && oldStatus !== 'Received') {

      // ── Update matching Inventory item with serial + warranty info ───────────
      try {
        const { Item } = await import('../models/Inventory.js');

        // Item model uses `store` (string of companyId), NOT `companyId` field
        const storeStr = request.companyId.toString();
        let inventoryItem = null;

        // Attempt 1: match by itemId (ObjectId reference — most reliable)
        if (request.itemId && /^[0-9a-fA-F]{24}$/.test(request.itemId)) {
          inventoryItem = await Item.findById(request.itemId);
        }

        // Attempt 2: match by name + store field
        if (!inventoryItem) {
          inventoryItem = await Item.findOne({
            name: { $regex: new RegExp(`^${request.productName.trim()}$`, 'i') },
            store: storeStr
          });
        }

        if (inventoryItem) {
          inventoryItem.serialNumber = request.serialNumber;
          inventoryItem.warranty.period = request.warrantyPeriod;
          if (request.warrantyCardUrl) {
            // Replace the old warranty card with the newly uploaded one —
            // delete the previous file so it doesn't linger orphaned on disk.
            const oldCardUrl = inventoryItem.warranty.cardUrl;
            if (oldCardUrl && oldCardUrl !== request.warrantyCardUrl) {
              try {
                const oldCardPath = path.join(process.cwd(), oldCardUrl.replace(/^\//, ''));
                if (fs.existsSync(oldCardPath)) fs.unlinkSync(oldCardPath);
              } catch (unlinkErr) {
                console.error('Failed to delete old warranty card:', oldCardUrl, unlinkErr.message);
              }
            }
            inventoryItem.warranty.cardUrl = request.warrantyCardUrl;
            inventoryItem.warranty.cardUploadedAt = new Date();
          }
          inventoryItem.receivedFromPurchaseRequest = request._id;
          await inventoryItem.save();
          console.log(`✅ Inventory item "${inventoryItem.name}" updated with serial & warranty info`);
        } else {
          console.warn(`⚠️  No matching inventory item found for "${request.productName}" – skipping inventory update`);
        }

        // 📊 Feed the delivery-date estimator: this request's full
        // request→receive cycle becomes one sample in this item's vendor
        // lead-time average. This IS the real Store "mark as Received" flow
        // (unlike controllers/purchaseController.js's receivePurchase,
        // which has no frontend caller at all) — this is the only place
        // that should ever record a Purchase-path sample. Best-effort,
        // never blocks receiving.
        try {
          const resolvedCode = request.materialCode || inventoryItem?.code || null;
          if (resolvedCode) {
            const { recordLeadTimeSample } = await import('../utils/leadTimeStats.js');
            const durationDays = (request.receivedAt.getTime() - new Date(request.requestDate).getTime()) / (1000 * 60 * 60 * 24);
            await recordLeadTimeSample(request.companyId, resolvedCode, request.productName, 'Purchase', durationDays);
          }
        } catch (statsErr) {
          console.error('❌ Error recording purchase lead-time sample:', statsErr.message);
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

          let qcCategory = 'Raw Material';
          let qcBaseUnit = request.unit || 'pcs';
          try {
            const inventoryItem = await Item.findOne({
              name: { $regex: new RegExp(`^${request.productName.trim()}$`, 'i') },
              companyId: request.companyId
            });
            if (inventoryItem && inventoryItem.category) {
              qcCategory = inventoryItem.category;
            }
            if (inventoryItem && inventoryItem.unit) {
              qcBaseUnit = inventoryItem.unit;
            }
          } catch (invLookupErr) {
            console.error('Error looking up inventory item for QC job category:', invLookupErr);
          }

          // Multi-item: resolve the sales orderCode for grouping in QC screens
          let qcOrderCode = '';
          try {
            if (request.storeOrderId) {
              const OrderModel = (await import('../models/Order.js')).default;
              const linkedOrder = await OrderModel.findById(request.storeOrderId).select('orderCode').lean();
              qcOrderCode = linkedOrder?.orderCode || '';
            }
          } catch (_) { /* optional */ }

          await QCJob.create({
            qcJobId,
            source: 'Purchase',
            sourceRefId: sourceRefId,
            purchaseRequestId: request._id,   // ← direct PR ref for reliable Sale lookup
            saleItemId: request.saleItemId || null, // ← exact order item this purchase fulfils
            orderCode: qcOrderCode,
            sourceDepartment: 'Store',
            sentBy: req.user.fullName || req.user.username || 'Store Dept',
            itemName: request.productName,
            itemCode: request.itemId || request.requestId,
            category: qcCategory,
            // Converted base-unit qty when the order was placed in a purchase unit
            // (e.g. 20 kg received ÷ 1 kg/pc = 20 pcs) — QC approval adds this qty to inventory
            quantity: request.convertedQuantity || request.quantity || 1,
            unit: qcBaseUnit,
            receivedDate: today(),
            status: 'Pending',
            company: request.companyId,
            createdBy: req.user._id,
            notes: `Automatically created from Store Purchase Requisition: ${request.requestId}`
          });
          console.log(`✅ QC Job ${qcJobId} automatically created for Purchase Request ${request.requestId} with category ${qcCategory}`);

          // 🔔 Notify QC team about new QC job
          try {
            await notificationService.triggerQCNotification({
              action: 'qc_job_created',
              data: { qcJobId, itemName: request.productName, requestId: request.requestId, quantity: request.quantity },
              targetCompanyId: request.companyId,
            });
          } catch (e) { console.error('QC job notification error:', e); }
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

      // 3. Re-resolve the item's purchase price NOW that the receive-time unit
      //    conversion factor is known. The auto-invoice (and the recalc it fires)
      //    is created at PO-generation time — BEFORE Store enters the conversion —
      //    so that early recalc stores the raw purchase-unit price. This is the
      //    authoritative "store received it" recalc with the factor available.
      try {
        const { recalculateItemPricing } = await import('../services/itemPricingService.js');
        const { Item } = await import('../models/Inventory.js');
        const storeStr = request.companyId.toString();

        let pricingItem = null;
        if (request.itemId && /^[0-9a-fA-F]{24}$/.test(request.itemId)) {
          pricingItem = await Item.findById(request.itemId);
        }
        if (!pricingItem) {
          pricingItem = await Item.findOne({
            name: { $regex: new RegExp(`^${request.productName.trim()}$`, 'i') },
            store: storeStr
          });
        }

        if (pricingItem && pricingItem.purchase && !pricingItem.internalManufacturing) {
          await recalculateItemPricing(pricingItem);
          console.log(`💰 [Purchase Receipt] Pricing re-resolved with unit conversion for "${pricingItem.code}"`);
        }
      } catch (pricingErr) {
        console.error('❌ Error recalculating item pricing on receipt:', pricingErr);
      }
    }

    res.status(200).json({ success: true, data: request });
  } catch (error) {
    console.error('Error updating purchase request:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
