import RFQ from '../models/RFQ.js';
import VendorBid from '../models/VendorBid.js';
import Supplier from '../models/Supplier.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import Purchase from '../models/Purchase.js';
import { Item } from '../models/Inventory.js';
import { Company } from '../models/Company.js';
import { sendRFQEmail, sendVendorBidConfirmationEmail } from '../services/emailService.js';
import crypto from 'crypto';
import notificationService from '../services/notificationService.js';

// ── Helper: generate unique RFQ number ────────────────────────────────────────
async function generateRFQNo() {
  const count = await RFQ.countDocuments({});
  const num = String(count + 1).padStart(4, '0');
  const candidate = `RFQ-${num}`;
  const exists = await RFQ.findOne({ rfqNo: candidate });
  if (exists) {
    return `RFQ-${Date.now().toString().slice(-6)}`;
  }
  return candidate;
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/rfq/vendors-for-rfq?purchaseRequestId=xxx  — Get all vendors with
//     their categories + which ones auto-match the given PR item
// ──────────────────────────────────────────────────────────────────────────────
export const getVendorsForRFQ = async (req, res) => {
  try {
    const { purchaseRequestId } = req.query;
    const companyId = req.user.companyId;
    const unit = req.user.unit;

    if (!purchaseRequestId) {
      return res.status(400).json({ success: false, message: 'purchaseRequestId is required' });
    }

    const pr = await PurchaseRequest.findById(purchaseRequestId);
    if (!pr) {
      return res.status(404).json({ success: false, message: 'Purchase Request not found' });
    }

    // Detect item category from inventory
    let itemCategory = '';
    try {
      const inventoryItem = await Item.findOne({
        $or: [
          { name: { $regex: new RegExp(pr.productName.trim().split(' ').slice(0, 2).join(' '), 'i') } },
          { code: pr.itemId }
        ],
        companyId
      });
      if (inventoryItem) {
        itemCategory = (inventoryItem.category || '').toLowerCase();
      }
    } catch (e) {
      console.warn('Inventory lookup failed in getVendorsForRFQ:', e.message);
    }

    // Build keyword list
    const nameKeywords = pr.productName.toLowerCase().split(/[\s\-_,]+/).filter(w => w.length > 2);
    const categoryKeywords = itemCategory ? itemCategory.split(/[\s\-_,]+/).filter(w => w.length > 2) : [];
    const allKeywords = [...new Set([...nameKeywords, ...categoryKeywords])];

    // Get all active vendors
    const allVendors = await Supplier.find({
      unit: { $in: [unit, 'Main'] },
      status: 'active'
    }).select('supplierName email phone vendorCategories rating unit');

    // Score each vendor for auto-match
    const scoreVendor = (vendor) => {
      if (!vendor.vendorCategories || vendor.vendorCategories.length === 0) return 0;
      const vendorCats = vendor.vendorCategories.map(c => c.toLowerCase());
      let score = 0;
      for (const keyword of allKeywords) {
        for (const cat of vendorCats) {
          if (cat === keyword) {
            score += 3;
          } else if (cat.includes(keyword) || keyword.includes(cat)) {
            score += 2;
          } else {
            const shorter = keyword.length < cat.length ? keyword : cat;
            const longer = keyword.length < cat.length ? cat : keyword;
            if (shorter.length >= 4 && longer.includes(shorter.slice(0, shorter.length - 1))) {
              score += 1;
            }
          }
        }
      }
      return score;
    };

    const vendorList = allVendors.map(v => ({
      _id: v._id,
      supplierName: v.supplierName,
      email: v.email,
      phone: v.phone,
      rating: v.rating,
      vendorCategories: v.vendorCategories || [],
      matchScore: scoreVendor(v),
      autoMatched: scoreVendor(v) > 0
    })).sort((a, b) => b.matchScore - a.matchScore);

    const autoMatchedCount = vendorList.filter(v => v.autoMatched).length;

    res.json({
      success: true,
      data: {
        vendors: vendorList,
        detectedCategory: itemCategory,
        keywords: allKeywords,
        productName: pr.productName,
        autoMatchedCount
      }
    });
  } catch (error) {
    console.error('getVendorsForRFQ error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// GET  /api/rfq  — List all RFQs for company
// ──────────────────────────────────────────────────────────────────────────────
export const getRFQs = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const query = { companyId: req.user.companyId };
    if (status) {
      // Comma-separated list (e.g. "Awarded,Closed" for the History tab) lets
      // one request cover several statuses via $in instead of exact match.
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      query.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
    }
    if (search) query.$or = [
      { rfqNo: { $regex: search, $options: 'i' } },
      { productName: { $regex: search, $options: 'i' } },
    ];

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [rfqs, total] = await Promise.all([
      RFQ.find(query)
        .populate('purchaseRequest', 'requestId productName quantity status')
        .populate('vendors', 'supplierName email phone vendorCategories')
        .populate('selectedVendor', 'supplierName email')
        .populate('selectedBid')
        .populate('createdBy', 'fullName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      RFQ.countDocuments(query),
    ]);

    // Attach bid counts (only for the current page's RFQs)
    const rfqIds = rfqs.map(r => r._id);
    const bidCounts = await VendorBid.aggregate([
      { $match: { rfq: { $in: rfqIds }, status: { $in: ['Submitted', 'Selected'] } } },
      { $group: { _id: '$rfq', count: { $sum: 1 } } }
    ]);
    const bidCountMap = {};
    bidCounts.forEach(b => { bidCountMap[b._id.toString()] = b.count; });

    const result = rfqs.map(rfq => ({
      ...rfq.toObject(),
      bidCount: bidCountMap[rfq._id.toString()] || 0
    }));

    res.json({
      success: true,
      data: result,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('getRFQs error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};



// ──────────────────────────────────────────────────────────────────────────────
// POST /api/rfq  — Create RFQ and send emails to matching vendors
// ──────────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────────
// POST /api/rfq  — Create RFQ and send emails to matching vendors
// ──────────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────────
// POST /api/rfq  — Create RFQ and send emails to matching vendors
// ──────────────────────────────────────────────────────────────────────────────
export const createRFQ = async (req, res) => {
  try {
    const { purchaseRequestId, requiredByDate, notes, vendorIds, purchaseQuantity, purchaseUnit } = req.body;
    const companyId = req.user.companyId;
    const unit = req.user.unit;

    // 1. Fetch the Purchase Request
    const pr = await PurchaseRequest.findById(purchaseRequestId);
    if (!pr) {
      return res.status(404).json({ success: false, message: 'Purchase Request not found' });
    }

    // 2. Check if RFQ already exists for this PR
    const existingRFQ = await RFQ.findOne({ purchaseRequest: purchaseRequestId, companyId });
    if (existingRFQ) {
      return res.status(400).json({
        success: false,
        message: `RFQ already exists for this request: ${existingRFQ.rfqNo}`
      });
    }

    // 3. Fetch Master Inventory Item early to get Category AND R&D Specifications
    let inventoryItem = null;
    let itemCategory = '';
    try {
      inventoryItem = await Item.findOne({
        $or: [
          { name: { $regex: new RegExp(pr.productName.trim().split(' ').slice(0, 2).join(' '), 'i') } },
          { code: pr.itemId }
        ],
        companyId
      });
      if (inventoryItem) itemCategory = (inventoryItem.category || '').toLowerCase();
    } catch (e) {
      console.warn('Could not fetch inventory item for RFQ matching:', e.message);
    }

    // 4. Fetch all active vendors
    const allVendors = await Supplier.find({
      unit: { $in: [unit, 'Main'] },
      status: 'active'
    });

    let matchedVendors = [];
    let matchType = 'manual';

    if (vendorIds && Array.isArray(vendorIds) && vendorIds.length > 0) {
      // Frontend sent explicit vendor IDs (User picked them from the popup)
      matchedVendors = allVendors.filter(v => vendorIds.includes(v._id.toString()));
      matchType = 'manual-selected';
    }

    // Fallback: no vendors sent from frontend — run auto-match algorithm!
    if (matchedVendors.length === 0) {
      const nameKeywords = pr.productName.toLowerCase().split(/[\s\-_,]+/).filter(w => w.length > 2);
      const categoryKeywords = itemCategory ? itemCategory.split(/[\s\-_,]+/).filter(w => w.length > 2) : [];
      const allKeywords = [...new Set([...nameKeywords, ...categoryKeywords])];

      const scoreVendor = (vendor) => {
        if (!vendor.vendorCategories || vendor.vendorCategories.length === 0) return 0;
        const vendorCats = vendor.vendorCategories.map(c => c.toLowerCase());
        let score = 0;
        for (const keyword of allKeywords) {
          for (const cat of vendorCats) {
            if (cat === keyword) score += 3;
            else if (cat.includes(keyword) || keyword.includes(cat)) score += 2;
            else {
              const shorter = keyword.length < cat.length ? keyword : cat;
              const longer = keyword.length < cat.length ? cat : keyword;
              if (shorter.length >= 4 && longer.includes(shorter.slice(0, shorter.length - 1))) score += 1;
            }
          }
        }
        return score;
      };

      matchedVendors = allVendors
        .map(v => ({ vendor: v, score: scoreVendor(v) }))
        .filter(sv => sv.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(sv => sv.vendor);

      matchType = matchedVendors.length > 0 ? 'category-matched' : 'no-match';
      if (matchedVendors.length > 0) {
        console.log(`[RFQ] Auto-match Success | Item: "${pr.productName}" | Found: ${matchedVendors.length}`);
      }
    }

    // Still no vendors — Cannot auto-send. Return 400 to open frontend Popup!
    if (matchedVendors.length === 0) {
      return res.status(400).json({
        success: false,
        message: `No vendors matched for "${pr.productName}". Please select vendors manually.`,
        data: {
          productName: pr.productName,
          detectedCategory: itemCategory,
          allVendors: allVendors.map(v => ({
            _id: v._id,
            supplierName: v.supplierName,
            email: v.email,
            vendorCategories: v.vendorCategories || []
          }))
        }
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 5. INJECT R&D SPECS (Warranty excluded based on your request)
    // ─────────────────────────────────────────────────────────────
    let enrichedNotes = notes ? `${notes}\n\n` : '';
    if (inventoryItem && inventoryItem.specifications && inventoryItem.specifications.length > 0) {
      enrichedNotes += '--- STRICT R&D SPECIFICATIONS MUST BE MET ---\n';
      inventoryItem.specifications.forEach(spec => {
        if (spec.key && spec.value) enrichedNotes += `• ${spec.key}: ${spec.value}\n`;
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 5b. PURCHASE UNIT ORDERING: when the master item defines a
    // Purchase Unit, the Purchase dept orders in that unit and the
    // Store converts back to the base unit at receiving time.
    // ─────────────────────────────────────────────────────────────
    const resolvedPurchaseUnit = purchaseUnit || inventoryItem?.purchaseUnit || null;
    const resolvedPurchaseQty = Number(purchaseQuantity) > 0 ? Number(purchaseQuantity) : null;
    if (resolvedPurchaseQty && resolvedPurchaseUnit) {
      pr.purchaseQuantity = resolvedPurchaseQty;
      pr.purchaseUnit = resolvedPurchaseUnit;
      pr.purchaseUnitType = inventoryItem?.purchaseUnitType || pr.purchaseUnitType || null;
      await pr.save();
    }
    // Vendor sees the Purchase Unit when defined; otherwise the item's Base Unit
    const rfqQuantity = (resolvedPurchaseQty && resolvedPurchaseUnit) ? resolvedPurchaseQty : pr.quantity;
    const rfqQuantityUnit = (resolvedPurchaseQty && resolvedPurchaseUnit)
      ? resolvedPurchaseUnit
      : (inventoryItem?.unit || pr.unit || null);

    // 6. Create RFQ
    const rfqNo = await generateRFQNo();
    const rfq = await RFQ.create({
      rfqNo,
      purchaseRequest: purchaseRequestId,
      productName: pr.productName,
      quantity: rfqQuantity,
      quantityUnit: rfqQuantityUnit,
      requiredByDate: requiredByDate ? new Date(requiredByDate) : null,
      vendors: matchedVendors.map(v => v._id),
      notes: enrichedNotes, // <-- Has user notes + specs injected
      companyId,
      unit,
      createdBy: req.user._id,
      emailSentAt: new Date()
    });

    // 7. Create VendorBid invite records with unique tokens and send emails
    const company = await Company.findById(companyId);
    const companyName = company?.name || 'Samtek';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    // Each promise resolves to a { vendor, success, error } result — never
    // rejects — so a broken SMTP server can't silently disappear behind
    // Promise.allSettled and get reported back to the user as "success".
    const emailResults = await Promise.allSettled(matchedVendors.map(async (vendor) => {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await VendorBid.create({
        rfq: rfq._id,
        rfqNo: rfq.rfqNo,
        vendor: vendor._id,
        vendorName: vendor.supplierName,
        productName: pr.productName,
        quantity: rfqQuantity,
        unitPrice: 0,
        totalPrice: 0,
        deliveryDays: 7,
        bidToken: token,
        tokenExpiry,
        status: 'Invited',
        companyId,
        unit
      });

      const bidLink = `${frontendUrl}/vendor-bid/${token}`;

      try {
        await sendRFQEmail({
          companyId,
          to: vendor.email,
          vendorName: vendor.supplierName,
          rfqNo: rfq.rfqNo,
          productName: pr.productName,
          quantity: rfqQuantity,
          quantityUnit: rfqQuantityUnit,
          requiredByDate: requiredByDate,
          bidLink,
          companyName,
          notes: enrichedNotes // <-- Vendors see specs in email, no warranty sent
        });
        return { vendor, success: true };
      } catch (emailError) {
        console.error(`❌ RFQ email failed for ${vendor.email}:`, emailError.message);
        return { vendor, success: false, error: emailError.message };
      }
    }));

    const outcomes = emailResults.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message });
    const sentOk = outcomes.filter(o => o.success);
    const failed = outcomes.filter(o => !o.success);

    // TOTAL FAILURE — this is what a dead/misconfigured SMTP server looks
    // like (every single vendor email failed). Roll back the RFQ/VendorBid
    // records we just created and the PR stays exactly as it was — Accounts
    // sees a real error and "Send RFQ" is available to retry, instead of a
    // false "success" hiding a broken mail server.
    if (matchedVendors.length > 0 && sentOk.length === 0) {
      await VendorBid.deleteMany({ rfq: rfq._id });
      await RFQ.findByIdAndDelete(rfq._id);
      return res.status(502).json({
        success: false,
        message: `RFQ email could not be sent to any vendor — the mail server is unreachable or misconfigured. No RFQ was created; fix SMTP settings and try again. (${failed[0]?.error || 'unknown email error'})`
      });
    }

    // 8. Update PR status to Approved (RFQ sent) — only reached when at
    // least one vendor genuinely received the email.
    await PurchaseRequest.findByIdAndUpdate(purchaseRequestId, { status: 'Approved' });

    const populated = await RFQ.findById(rfq._id)
      .populate('purchaseRequest', 'requestId productName quantity')
      .populate('vendors', 'supplierName email vendorCategories');

    // Partial failure — some vendors reached, some didn't. Still a genuine
    // success (RFQ is live and usable), but honestly report who was missed
    // instead of claiming every vendor got it.
    const message = failed.length > 0
      ? `RFQ ${rfqNo} created. Emails sent to ${sentOk.length} of ${matchedVendors.length} vendor(s) [${matchType}]. Failed for: ${failed.map(f => f.vendor?.supplierName || f.vendor?.email).filter(Boolean).join(', ')} — notify them manually.`
      : `RFQ ${rfqNo} created. Emails sent to ${matchedVendors.length} vendor(s) [${matchType}].`;

    res.status(201).json({
      success: true,
      message,
      partialEmailFailure: failed.length > 0,
      failedVendors: failed.map(f => ({ name: f.vendor?.supplierName, email: f.vendor?.email, error: f.error })),
      data: populated
    });

    // 🔔 Notify Accounts about new RFQ
    try {
      await notificationService.triggerAccountsNotification({
        action: 'rfq_vendor_bid_received',
        data: { rfqNumber: rfqNo, productName: pr.productName, rfqId: rfq._id },
        targetCompanyId: req.user.companyId,
      });
    } catch (e) { console.error('RFQ notification error:', e); }

  } catch (error) {
    console.error('createRFQ error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
// ──────────────────────────────────────────────────────────────────────────────
// GET /api/rfq/:id/bids  — Get all bids for an RFQ
// ──────────────────────────────────────────────────────────────────────────────
export const getRFQBids = async (req, res) => {
  try {
    const rfq = await RFQ.findOne({ _id: req.params.id, companyId: req.user.companyId })
      .populate('purchaseRequest', 'requestId productName quantity status');

    if (!rfq) {
      return res.status(404).json({ success: false, message: 'RFQ not found' });
    }

    const bids = await VendorBid.find({ rfq: rfq._id })
      .populate('vendor', 'supplierName email phone rating vendorCategories')
      .sort({ unitPrice: 1 }); // Sort cheapest first

    // Enrich bids with vendor stats
    const enriched = bids.map(bid => {
      const vendor = bid.vendor;
      return {
        ...bid.toObject(),
        vendorRating: vendor?.rating || 0,
        vendorCategories: vendor?.vendorCategories || []
      };
    });

    res.json({ success: true, data: { rfq, bids: enriched } });
  } catch (error) {
    console.error('getRFQBids error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/rfq/:id/select-vendor  — Select winning vendor & auto-create PO
// ──────────────────────────────────────────────────────────────────────────────
export const selectVendor = async (req, res) => {
  try {
    const { bidId } = req.body;
    const companyId = req.user.companyId;

    const rfq = await RFQ.findOne({ _id: req.params.id, companyId })
      .populate('purchaseRequest');
    if (!rfq) {
      return res.status(404).json({ success: false, message: 'RFQ not found' });
    }

    const winningBid = await VendorBid.findById(bidId).populate('vendor');
    if (!winningBid) {
      return res.status(404).json({ success: false, message: 'Bid not found' });
    }

    // 1. Mark winning bid as Selected, others as Rejected
    await VendorBid.updateMany({ rfq: rfq._id, _id: { $ne: bidId } }, { status: 'Rejected' });
    winningBid.status = 'Selected';
    await winningBid.save();

    // 2. Update RFQ
    rfq.status = 'Awarded';
    rfq.selectedVendor = winningBid.vendor._id;
    rfq.selectedBid = winningBid._id;
    await rfq.save();

    // 3. Auto-create Purchase Order
    const pr = rfq.purchaseRequest;

    // Find matching inventory item (optional — PO is created even if no match)
    let inventoryItemId = null;
    let inventoryItemName = pr.productName;

    const matchedItem = await Item.findOne({
      name: { $regex: new RegExp(`^${pr.productName.trim()}$`, 'i') },
      companyId
    });

    try {
      // Escape special regex characters in product name before using in regex
      const escapedName = pr.productName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const matchedItem = await Item.findOne({
        name: { $regex: new RegExp(`^${escapedName}$`, 'i') },
        companyId
      });

      if (matchedItem) {
        inventoryItemId = matchedItem._id;
        inventoryItemName = matchedItem.name;
      } else {
        // Try partial match using first meaningful word (skip very short words)
        const firstWord = pr.productName.trim().split(/\s+/).find(w => w.length > 3) || pr.productName.split(' ')[0];
        const escapedWord = firstWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const partialMatch = await Item.findOne({
          name: { $regex: new RegExp(escapedWord, 'i') },
          companyId
        });
        if (partialMatch) {
          inventoryItemId = partialMatch._id;
          inventoryItemName = partialMatch.name;
        }
      }
    } catch (itemLookupErr) {
      console.warn('[selectVendor] Inventory item lookup failed (non-fatal):', itemLookupErr.message);
    }

    // inventoryItemId may be null — PO will be created with itemName only (item link added on receipt)

    const unitPrice = winningBid.unitPrice;
    // When ordered in a purchase unit (e.g. 20 kg for a 10-pc demand), the PO is for that qty
    const orderQty = pr.purchaseQuantity || pr.quantity;
    const totalAmount = unitPrice * orderQty;
    // Vendor's bid price is used as-is on the PO — GST is never added on top
    // of it internally, since the vendor already quoted their final price.
    const taxAmount = 0;
    const grandTotal = totalAmount;

    // Resolve delivery address from company
    const company = await Company.findById(companyId);
    const deliveryAddress = company
      ? `${company.address || ''}, ${company.city || ''}, ${company.state || ''} - ${company.locationPin || ''}`.replace(/^,\s*/, '').replace(/,\s*,/g, ',')
      : 'Main Warehouse';

    const expectedDelivery = new Date(Date.now() + winningBid.deliveryDays * 24 * 60 * 60 * 1000);

    // Build PO line item — only include item ref if we found one in inventory
    const poLineItem = {
      itemName: inventoryItemName,
      quantity: orderQty,
      unitPrice,
      totalPrice: totalAmount,
      receivedQuantity: 0,
      pendingQuantity: orderQty
    };
    if (inventoryItemId) {
      poLineItem.item = inventoryItemId;
    }

    const po = await Purchase.create({
      supplier: winningBid.vendor._id,
      items: [poLineItem],
      totalAmount,
      taxAmount,
      grandTotal,
      expectedDeliveryDate: expectedDelivery,
      unit: rfq.unit,
      createdBy: req.user._id,
      deliveryAddress,
      terms: `Delivery within ${winningBid.deliveryDays} days. Warranty: ${winningBid.warrantyMonths} months.`,
      notes: `Auto-generated from RFQ ${rfq.rfqNo}. Vendor selected from bidding process.`,
      purchaseRequest: pr._id,
      status: 'Draft'
    });

    // 4. Link PO to RFQ and PR
    rfq.purchaseOrder = po._id;
    await rfq.save();

    await PurchaseRequest.findByIdAndUpdate(pr._id, {
      purchaseOrder: po._id,
      status: 'Ordered'
    });

    // 5. Send confirmation email to selected vendor
    const companyName = company?.name || 'Samtek';
    try {
      await sendVendorBidConfirmationEmail({
        companyId,
        to: winningBid.vendor.email,
        vendorName: winningBid.vendor.supplierName,
        rfqNo: rfq.rfqNo,
        poNumber: po.purchaseOrderNumber,
        productName: pr.productName,
        quantity: orderQty,
        unitPrice,
        deliveryDays: winningBid.deliveryDays,
        warrantyMonths: winningBid.warrantyMonths,
        companyName
      });
      console.log(`✅ Confirmation email sent to ${winningBid.vendor.supplierName}`);
    } catch (emailErr) {
      console.error('Confirmation email failed:', emailErr.message);
    }

    // 6. Auto-create Purchase Invoice immediately when PO is generated
    //    This ensures invoice exists before goods are even received — no duplicate on receipt
    try {
      const { createAutoPurchaseInvoice } = await import('./purchaseInvoiceController.js');
      // Fetch the full purchase request with populated PO for the invoice helper
      const fullPR = await PurchaseRequest.findById(pr._id).populate({
        path: 'purchaseOrder',
        populate: { path: 'supplier' }
      });
      if (fullPR) {
        await createAutoPurchaseInvoice(fullPR, req.user);
        console.log(`✅ [PO Created] Purchase Invoice auto-created for PO ${po.purchaseOrderNumber}`);
      }
    } catch (invoiceErr) {
      // Non-fatal — log but don't fail the PO creation response
      console.error('❌ [PO Created] Invoice creation failed (non-fatal):', invoiceErr.message);
    }

    res.json({
      success: true,
      message: `Vendor ${winningBid.vendor.supplierName} selected. PO ${po.purchaseOrderNumber} auto-created.`,
      data: {
        rfq: rfq._id,
        rfqNo: rfq.rfqNo,
        selectedVendor: winningBid.vendor.supplierName,
        po: {
          _id: po._id,
          purchaseOrderNumber: po.purchaseOrderNumber,
          grandTotal: po.grandTotal,
          expectedDeliveryDate: po.expectedDeliveryDate
        }
      }
    });
  } catch (error) {
    console.error('selectVendor error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// PUBLIC: GET /api/rfq/bid/:token  — Vendor reads bid invitation (no auth)
// ──────────────────────────────────────────────────────────────────────────────
export const getBidByToken = async (req, res) => {
  try {
    const bid = await VendorBid.findOne({ bidToken: req.params.token })
      .populate('vendor', 'supplierName email phone')
      .populate('rfq', 'rfqNo productName quantity quantityUnit requiredByDate notes status');

    if (!bid) {
      return res.status(404).json({ success: false, message: 'Invalid or expired bid link' });
    }

    // Check token expiry
    if (bid.tokenExpiry && new Date() > bid.tokenExpiry) {
      return res.status(410).json({ success: false, message: 'This bid link has expired' });
    }

    // Check RFQ is still open
    if (bid.rfq.status !== 'Open') {
      return res.status(400).json({
        success: false,
        message: bid.status === 'Submitted'
          ? 'You have already submitted your bid for this RFQ.'
          : 'This RFQ is no longer accepting bids.'
      });
    }

    res.json({
      success: true,
      data: {
        rfqNo: bid.rfq.rfqNo,
        productName: bid.productName,
        quantity: bid.quantity,
        quantityUnit: bid.rfq.quantityUnit || null,
        requiredByDate: bid.rfq.requiredByDate,
        notes: bid.rfq.notes,
        vendorName: bid.vendor.supplierName,
        bidStatus: bid.status,
        // If already submitted, return submitted values
        existingBid: bid.status === 'Submitted' ? {
          unitPrice: bid.unitPrice,
          deliveryDays: bid.deliveryDays,
          warrantyMonths: bid.warrantyMonths,
          remarks: bid.remarks
        } : null
      }
    });
  } catch (error) {
    console.error('getBidByToken error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// PUBLIC: POST /api/rfq/bid/:token  — Vendor submits bid (no auth)
// ──────────────────────────────────────────────────────────────────────────────
export const submitBidByToken = async (req, res) => {
  try {
    const { unitPrice, deliveryDays, warrantyMonths, remarks } = req.body;

    if (!unitPrice || unitPrice <= 0) {
      return res.status(400).json({ success: false, message: 'Please enter a valid unit price' });
    }
    if (!deliveryDays || deliveryDays <= 0) {
      return res.status(400).json({ success: false, message: 'Please enter a valid delivery time in days' });
    }

    const bid = await VendorBid.findOne({ bidToken: req.params.token })
      .populate('rfq', 'status productName quantity');

    if (!bid) {
      return res.status(404).json({ success: false, message: 'Invalid bid link' });
    }

    if (bid.tokenExpiry && new Date() > bid.tokenExpiry) {
      return res.status(410).json({ success: false, message: 'This bid link has expired' });
    }

    if (bid.status === 'Submitted') {
      return res.status(400).json({ success: false, message: 'You have already submitted your bid' });
    }

    if (bid.rfq.status !== 'Open') {
      return res.status(400).json({ success: false, message: 'This RFQ is no longer accepting bids' });
    }

    // Update bid
    bid.unitPrice = parseFloat(unitPrice);
    bid.totalPrice = parseFloat(unitPrice) * bid.quantity;
    bid.deliveryDays = parseInt(deliveryDays);
    bid.warrantyMonths = parseInt(warrantyMonths) || 0;
    bid.remarks = remarks || '';
    bid.status = 'Submitted';
    bid.submittedAt = new Date();
    await bid.save();

    res.json({
      success: true,
      message: 'Your bid has been submitted successfully. You will be notified if selected.',
      data: {
        rfqNo: bid.rfqNo,
        productName: bid.productName,
        quantity: bid.quantity,
        unitPrice: bid.unitPrice,
        totalPrice: bid.totalPrice,
        deliveryDays: bid.deliveryDays,
        warrantyMonths: bid.warrantyMonths
      }
    });

    // 🔔 Notify Accounts team that vendor bid received
    try {
      await notificationService.triggerAccountsNotification({
        action: 'rfq_vendor_bid_received',
        data: { rfqNumber: bid.rfqNo, vendorName: bid.vendorName, productName: bid.productName, bidId: bid._id },
        targetCompanyId: bid.companyId,
      });
    } catch (e) { console.error('Vendor bid notification error:', e); }
  } catch (error) {
    console.error('submitBidByToken error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/rfq/stats  — Dashboard stats
// ──────────────────────────────────────────────────────────────────────────────
export const getRFQStats = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const [total, open, awarded, totalBids, pendingBids] = await Promise.all([
      RFQ.countDocuments({ companyId }),
      RFQ.countDocuments({ companyId, status: 'Open' }),
      RFQ.countDocuments({ companyId, status: 'Awarded' }),
      VendorBid.countDocuments({ companyId }),
      VendorBid.countDocuments({ companyId, status: 'Invited' })
    ]);

    res.json({
      success: true,
      data: { total, open, awarded, totalBids, pendingBids }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
