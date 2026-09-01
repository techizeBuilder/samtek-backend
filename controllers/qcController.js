import QCJob from '../models/QCJob.js';
import { Item } from '../models/Inventory.js';
import ProductionOrder from '../models/ProductionOrder.js';
import Sale from '../models/Sale.js';
import notificationService from '../services/notificationService.js';
import RDQualityParam from '../models/RDQualityParam.js';
import { resolveSalesOrderCodeForQCJob } from '../utils/resolveSalesOrderCode.js';
import { setSaleItemStatus, isMachineJobItem } from '../services/storeFlowService.js';
import { dimensionSignature } from '../services/fabricationDemandService.js';
import { ensureFlatChecklist, ensurePartChecksStructure, attachPartReference, resolveItemForJob } from '../services/qcChecklistPullService.js';

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
    const { status, source, category, search, page, limit, withStatusCounts } = req.query;
    const filter = { company: req.user.companyId };
    if (status) filter.status = status;
    if (source) filter.source = source;
    if (category) filter.category = category;

    const isPaginated = !!(page || limit);
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);

    let statusCounts;
    if (withStatusCounts === 'true') {
      const countsAgg = await QCJob.aggregate([
        { $match: { company: req.user.companyId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);
      statusCounts = countsAgg.reduce((acc, c) => { acc[c._id] = c.count; return acc; }, {});
      statusCounts.all = countsAgg.reduce((sum, c) => sum + c.count, 0);
    }

    if (search) {
      // orderCode is resolved per-job (not a stored/indexed field), so
      // matching it requires enriching every job in the filtered set —
      // this path accepts that per-row lookup cost only while actively
      // searching, rather than paginating first and silently missing
      // order-code matches that fall outside the current page.
      const jobs = await QCJob.find(filter).sort({ createdAt: -1 }).lean();
      const jobsWithOrderCode = await Promise.all(jobs.map(async (job) => ({
        ...job,
        orderCode: await resolveSalesOrderCodeForQCJob(job, req.user.companyId),
      })));
      const s = search.toLowerCase();
      const matched = jobsWithOrderCode.filter(j =>
        (j.qcJobId || '').toLowerCase().includes(s) ||
        (j.itemName || '').toLowerCase().includes(s) ||
        (j.sourceRefId || '').toLowerCase().includes(s) ||
        (j.inspector || '').toLowerCase().includes(s) ||
        (j.orderCode || '').toLowerCase().includes(s)
      );

      if (isPaginated) {
        const total = matched.length;
        const data = matched.slice((pageNum - 1) * limitNum, pageNum * limitNum);
        return res.json({
          success: true, data,
          pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
          ...(statusCounts ? { statusCounts } : {}),
        });
      }
      return res.json({ success: true, data: matched, ...(statusCounts ? { statusCounts } : {}) });
    }

    if (isPaginated) {
      // Real DB-level pagination — resolveSalesOrderCodeForQCJob now only
      // runs for the current page's rows, not the entire company history.
      const [jobs, total] = await Promise.all([
        QCJob.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
        QCJob.countDocuments(filter),
      ]);
      const jobsWithOrderCode = await Promise.all(jobs.map(async (job) => ({
        ...job,
        orderCode: await resolveSalesOrderCodeForQCJob(job, req.user.companyId),
      })));
      return res.json({
        success: true, data: jobsWithOrderCode,
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
        ...(statusCounts ? { statusCounts } : {}),
      });
    }

    // No page/limit sent — original unbounded behavior, unchanged.
    const jobs = await QCJob.find(filter).sort({ createdAt: -1 }).lean();
    const jobsWithOrderCode = await Promise.all(jobs.map(async (job) => ({
      ...job,
      orderCode: await resolveSalesOrderCodeForQCJob(job, req.user.companyId),
    })));
    res.json({ success: true, data: jobsWithOrderCode, ...(statusCounts ? { statusCounts } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Lazy pull happens here, not at any of the 4 creation sites — computing a
// checklist for every job the moment it's created (or worse, for all ~145
// jobs the list view shows) would be wasted work for jobs nobody ever opens.
// Only the act of a real GET-by-id (someone actually opening this one job)
// triggers it, and only once — confirmed 2026-09-01. A no-op save is skipped
// (both helpers return false when there's nothing new to persist) so opening
// an already-populated job stays a pure read.
export const getQCJob = async (req, res) => {
  try {
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'QC job not found' });

    // For a manufactured job (real partChecks[]), the QCJob exists — and is
    // openable by QC — from the moment Production first touches Fabrication,
    // long before the order ever reaches Final Testing. Pulling the Final
    // checklist's rows here unconditionally let QC "Start Inspection" and
    // see/edit a fully live Inspection Checklist while Production hadn't
    // even submitted it yet (real bug, caught 2026-09-02 — only 1 of 2 Sub
    // Child Parts were done). Now it only gets pulled once Production has
    // actually filled it in (saveFinalChecklist sets finalCheckFilledAt);
    // non-manufactured jobs (partChecks empty) keep the original immediate
    // pull, unaffected.
    const finalCheckReady = job.partChecks.length === 0 || !!job.finalCheckFilledAt;
    const changedChecklist = finalCheckReady ? await ensureFlatChecklist(job, req.user.companyId) : false;
    const changedParts = job.source === 'Production' ? await ensurePartChecksStructure(job, req.user.companyId) : false;
    if (changedChecklist || changedParts) await job.save();

    const orderCode = await resolveSalesOrderCodeForQCJob(job.toObject(), req.user.companyId);

    // Same designFile/materials reference Production's own parts panel gets
    // (getPartsQC) — QC reviewing a part needs to see the real BOM spec too,
    // not just the checklist labels (confirmed 2026-09-02).
    let partChecks = job.partChecks;
    if (job.partChecks.length > 0) {
      const item = await resolveItemForJob(job, req.user.companyId);
      if (item) partChecks = await attachPartReference(job.partChecks, item._id, req.user.companyId);
    }

    res.json({ success: true, data: { ...job.toObject(), partChecks, orderCode } });
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

    // Assuming generateQCJobId is defined earlier in your file
    const qcJobId = await generateQCJobId();

    // 1. Start with the default checklist provided by the frontend request
    let finalChecklist = (checklist || []).map(c => ({
      parameter: c.parameter,
      standardValue: c.standardValue || '',
      actualValue: '',
      status: 'Pending',
      remarks: '',
    }));

    // 2. ⚡ THE R&D BRIDGE INTERCEPTOR ⚡
    try {
      // Directly search RDQualityParam using the itemName
      const rdParams = await RDQualityParam.findOne({
        machineName: itemName,
        company: req.user.companyId
      }).lean();

      if (rdParams) {
        console.log(`[QC Bridge] 🔗 Found R&D Parameters for: ${itemName}. Overwriting default checklist.`);

        // We found R&D data! Clear the default frontend checklist to overwrite it
        finalChecklist = [];

        // Map R&D 'parameters' (measurable limits)
        if (rdParams.parameters && rdParams.parameters.length > 0) {
          rdParams.parameters.forEach(p => {
            let stdValue = p.performanceStandard || '';
            if (p.tolerance) stdValue += ` (Tol: ${p.tolerance})`;

            finalChecklist.push({
              parameter: p.parameter,
              standardValue: stdValue.trim(),
              actualValue: '',
              status: 'Pending',
              remarks: ''
            });
          });
        }

        // Map R&D 'qcChecklist' (binary visual/functional checks)
        if (rdParams.qcChecklist && rdParams.qcChecklist.length > 0) {
          rdParams.qcChecklist.forEach(c => {
            finalChecklist.push({
              parameter: c.item,
              standardValue: 'Verified',
              actualValue: '',
              status: 'Pending',
              remarks: ''
            });
          });
        }
      } else {
        console.log(`[QC Bridge] ℹ️ No R&D Parameters found for: ${itemName}. Using default checklist.`);
      }
    } catch (bridgeError) {
      // If the bridge fails (e.g., DB error), log it but DO NOT crash the QC job creation
      console.warn(`⚠️ [QC Bridge] Failed to fetch R&D parameters for ${itemName}. Falling back to default.`, bridgeError);
    }

    // 3. Create the Job with the finalized checklist
    const job = await QCJob.create({
      qcJobId,
      source, sourceRefId, sourceDepartment, sentBy,
      itemName, itemCode, category,
      quantity: quantity || 1,
      unit: unit || 'pcs',
      receivedDate,
      checklist: finalChecklist, // Using our processed array
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
    } catch (e) {
      console.error('QC job created notification error:', e);
    }

    res.status(201).json({ success: true, data: job });
  } catch (err) {
    console.error('❌ Error in createQCJob:', err);
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
    const { actualValue, status, remarks, qcStatus, qcRemarks } = req.body;

    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const item = job.checklist.id(itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Checklist item not found' });

    // A manufactured job's Final Check was already filled in by Production
    // (saveFinalChecklist) — actualValue/status/remarks are THEIR record, so
    // QC never touches them here, only its own separate qcStatus/qcRemarks
    // (confirmed 2026-09-02). Every other job's checklist has no Production
    // layer at all — QC's status/actualValue/remarks stay the one record,
    // exactly as before this change.
    if (job.partChecks.length > 0) {
      if (qcStatus !== undefined) item.qcStatus = qcStatus;
      if (qcRemarks !== undefined) item.qcRemarks = qcRemarks;
    } else {
      if (actualValue !== undefined) item.actualValue = actualValue;
      if (status !== undefined) item.status = status;
      if (remarks !== undefined) item.remarks = remarks;
    }

    await job.save();
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const submitDecision = async (req, res) => {
  try {
    const { decision, failReason, inspectorRemarks, rejectQty } = req.body;
    if (!decision || !['Pass', 'Fail'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'decision must be Pass or Fail' });
    }
    if (decision === 'Fail' && !failReason) {
      return res.status(400).json({ success: false, message: 'failReason is required when decision is Fail' });
    }

    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId, status: 'In Progress' });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found or not In Progress' });

    // Enforce: all checklist items must be inspected before a decision can be submitted.
    // A manufactured job's checklist is Production's own Final self-check —
    // the gate here is QC's own separate verdict (qcStatus), not theirs.
    if (job.checklist && job.checklist.length > 0) {
      const statusField = job.partChecks.length > 0 ? 'qcStatus' : 'status';
      const pendingItems = job.checklist.filter(c => c[statusField] === 'Pending');
      if (pendingItems.length > 0) {
        return res.status(400).json({
          success: false,
          message: `${pendingItems.length} checklist item${pendingItems.length > 1 ? 's' : ''} still pending. Complete all checklist items before submitting a decision.`
        });
      }
    }

    // In-house/outsource manufactured product: this decision IS the Final
    // Check (the whole assembled machine) — see QCJob.js's own comment.
    // It can't be submitted until every Sub Child Part has cleared its own
    // Initial+Process review, same "one job holds the whole history, but
    // the final verdict only makes sense once every part is done" ordering
    // confirmed 2026-09-01.
    if (job.partChecks && job.partChecks.length > 0) {
      const unresolvedParts = job.partChecks.filter(p => p.status !== 'Approved');
      if (unresolvedParts.length > 0) {
        return res.status(400).json({
          success: false,
          message: `${unresolvedParts.length} Sub Child Part${unresolvedParts.length > 1 ? 's' : ''} still not QC-approved. Approve every part before the Final Check.`
        });
      }
    }

    // Partial reject: job.quantity > 1 and QC only wants to fail part of it.
    // The job stays 'In Progress' with a reduced `quantity` — the remaining
    // units are still awaiting their own Approve/Fail decision, so this same
    // job can be decided on again. Omitting rejectQty (or sending it equal to
    // the full remaining quantity) is a full reject and falls through to the
    // unchanged legacy branch below.
    const parsedRejectQty = Number(rejectQty);
    const isPartialReject = decision === 'Fail'
      && Number.isFinite(parsedRejectQty) && parsedRejectQty > 0
      && parsedRejectQty < job.quantity;

    if (isPartialReject) {
      job.quantity -= parsedRejectQty;
      job.partialRejections.push({ qty: parsedRejectQty, reason: failReason, rejectedBy: req.user._id });
      job.returnedToSource = true;
      // Downstream helpers (createRejectedProductionOrder / createQCRejectedPurchaseReturn
      // / createQCRejectedPurchaseExchange) read qcJob.failReason for their
      // "why was this rejected" record — the terminal (non-partial) path sets
      // this too, but that only runs when the job fully closes. Set it here
      // too so a partial reject's reason actually reaches Repair/Rework/Exchange.
      job.failReason = failReason;

      if (job.source === 'Purchase') {
        try {
          const { createQCRejectedPurchaseReturn } = await import('./purchaseInvoiceController.js');
          await createQCRejectedPurchaseReturn(job, req.user, parsedRejectQty);
          console.log(`✅ [QC Partial Rejection] Created purchase return for ${parsedRejectQty} of ${job.itemName}; ${job.quantity} remaining in QC`);
        } catch (returnError) {
          console.error('❌ Error creating purchase return for partially rejected purchase item:', returnError);
        }
        try {
          const { createQCRejectedPurchaseExchange } = await import('./purchaseExchangeController.js');
          await createQCRejectedPurchaseExchange(job, req.user, parsedRejectQty);
        } catch (exchangeError) {
          console.error('❌ Error creating purchase exchange for partially rejected purchase item:', exchangeError);
        }
      } else if (job.source === 'Store') {
        // Store sent this item straight to QC (e.g. a Purchase/Manufacturing
        // Machine already sitting in stock) — the rejected qty simply goes
        // back to Store's inventory. No Production rework order: there was
        // never a production run behind this item, and Store re-routes the
        // restored qty itself via Check Inventory (reactivated below since
        // storeQCStatus is left untouched on a partial reject anyway).
        await restoreStoreInventoryQty(job, parsedRejectQty);
        // Unlike a full reject, the linked Sale item's storeQCStatus is left
        // untouched here — the remaining quantity is still actively in QC.
      } else {
        try {
          await createRejectedProductionOrder(job, req.user, parsedRejectQty);
          console.log(`✅ [QC Partial Rejection] Created production order for ${parsedRejectQty} of ${job.itemName}; ${job.quantity} remaining in QC`);
        } catch (prodError) {
          console.error('❌ Error creating production order for partially rejected item:', prodError);
        }
        // Unlike a full reject, the linked Sale item's storeQCStatus is left
        // untouched here — the remaining quantity is still actively in QC.
      }

      await job.save();

      try {
        await notificationService.triggerQCNotification({
          action: 'qc_failed',
          data: { qcJobId: job.qcJobId, itemName: job.itemName, failReason, jobId: job._id, partial: true, rejectedQty: parsedRejectQty, remainingQty: job.quantity },
          targetCompanyId: job.company,
        });
      } catch (e) { console.error('QC decision notification error:', e); }

      return res.json({ success: true, data: job, partial: true });
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

      // Purchase-sourced jobs need the linked PurchaseRequest/Sale/sale-item
      // resolved before the inventory-vs-dispatch decision below (surplus
      // split) — resolved once here, reused in step 2 (Link QC Job back to
      // Sale) instead of querying it twice.
      let purchaseSaleCtx = null;

      let shouldAddToInventory = false;
      let inventoryAddQty = job.quantity || 1;
      if (job.source === 'Stock') {
        shouldAddToInventory = true;
      } else if (job.source === 'Purchase') {
        purchaseSaleCtx = await resolvePurchaseSaleContext(job);
        const isMachine = await isMachineJobItem(job, job.company);
        if (!isMachine) {
          shouldAddToInventory = true; // raw material — unchanged, always adds
        } else if (purchaseSaleCtx.saleItem) {
          // Machine/Motor purchase: Purchase can legitimately buy more than
          // the linked order needs (vendor MOQ, buying ahead). Only the
          // surplus beyond what the sale item still needs should land in
          // inventory (e.g. Motor Master stock) — the rest still dispatches.
          const remainingNeeded = Math.max(0, (purchaseSaleCtx.saleItem.quantity || 0) - (purchaseSaleCtx.saleItem.approvedQty || 0));
          const surplusQty = Math.max(0, (job.quantity || 0) - remainingNeeded);
          if (surplusQty > 0) {
            shouldAddToInventory = true;
            inventoryAddQty = surplusQty;
            // Shrink the job's own quantity to just the dispatch-bound
            // portion — the Sale approvedQty update below and the Packaging
            // queue's per-unit job count both read job.quantity fresh, so
            // this one change is enough to keep dispatch in sync too.
            job.quantity -= surplusQty;
          }
        }
        // No linked sale item found (e.g. a standalone purchase not tied to
        // any order) → fall back to the pre-fix behavior: nothing added,
        // whole qty treated as dispatch-bound.
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

          // Fabrication Master items only — Store recorded a per-dimension
          // breakdown at receive time (PurchaseRequest.receivedFabricationLines,
          // see purchaseRequestController.js's receiveFabricationPurchase).
          // These items don't use flat Item.qty as their real stock measure —
          // dimensionVariants[].subStock already is — so credit each line
          // instead. A line matching an existing catalog/leftover variant
          // just increments it; a line the vendor shipped that isn't in the
          // catalog at all creates a new variant flagged isLeftover (usable
          // stock, never offered as a reorderable catalog size again).
          const receivedLines = job.source === 'Purchase' ? purchaseSaleCtx?.pr?.receivedFabricationLines : null;
          if (inventoryItem && receivedLines?.length > 0 && inventoryItem.fabricationRef) {
            for (const line of receivedLines) {
              const existingVariant = inventoryItem.dimensionVariants.find(
                dv => dimensionSignature(dv.values) === dimensionSignature(line.values)
              );
              if (existingVariant) {
                existingVariant.subStock = (existingVariant.subStock || 0) + line.quantity;
              } else {
                inventoryItem.dimensionVariants.push({
                  category: inventoryItem.dimensionVariants?.[0]?.category || '',
                  values: line.values,
                  designation: '',
                  densityValue: inventoryItem.dimensionVariants?.[0]?.densityValue ?? null,
                  densityUnit: inventoryItem.dimensionVariants?.[0]?.densityUnit || 'kg/m3',
                  weightPerMeterKg: null,
                  weightPerPieceKg: line.weightPerPieceKg ?? null,
                  subStock: line.quantity,
                  isLeftover: true,
                });
              }
            }
            await inventoryItem.save();
            console.log(`✅ [QC Approval - ${job.source}] Fabrication dimension stock credited for ${inventoryItem.name} (${receivedLines.length} line(s))`);
          } else if (inventoryItem) {
            const prevQty = inventoryItem.qty || 0;
            inventoryItem.qty = prevQty + inventoryAddQty;
            await inventoryItem.save();
            console.log(`✅ [QC Approval - ${job.source}] Inventory updated for ${inventoryItem.name}. Prev: ${prevQty}, New: ${inventoryItem.qty}`);
          } else {
            const newCode = job.itemCode || `ITEM-${Date.now()}`;
            inventoryItem = await Item.create({
              name: job.itemName,
              code: newCode,
              category: job.category || 'Raw Material',
              qty: inventoryAddQty,
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
            // Multi-item: update only THIS item's status (falls back to the
            // whole-sale field for legacy jobs without saleItemId), then the
            // aggregate is recomputed inside setSaleItemStatus.
            let itemIdForUpdate = job.saleItemId;
            if (!itemIdForUpdate && job.source === 'Production' && job.sourceRefId) {
              // Production QC jobs may predate saleItemId — recover it from the ProductionOrder
              try {
                const srcProd = await ProductionOrder.findOne({ orderId: job.sourceRefId, company: job.company })
                  .select('saleItemId').lean();
                itemIdForUpdate = srcProd?.saleItemId || null;
              } catch (_) { /* fall back to sale-level */ }
            }
            const perItem = await setSaleItemStatus(saleByRef, itemIdForUpdate, 'Approved from QC', { qty: job.quantity });
            console.log(`✅ [QC Approval - ${job.source}] 'Approved from QC' for Sale ${saleByRef._id}${perItem ? ` (item ${itemIdForUpdate})` : ' (sale-level)'}`);
          } else {
            console.warn(`⚠️ [QC Approval - ${job.source}] Could not find linked Sale for QC Job ${job.qcJobId}. saleId: ${job.saleId}, sourceRefId: ${job.sourceRefId}`);
          }
        } catch (e) { console.error(`❌ Error updating Sale on ${job.source} QC approval:`, e); }

      } else if (job.source === 'QC_Rejected') {
        // Re-made item for original order — mark that item ready for dispatch.
        try {
          const linkedProdOrder = await ProductionOrder.findOne({
            $or: [
              { orderId: job.sourceRefId },
              { _id: job.sourceRefId && /^[0-9a-fA-F]{24}$/.test(job.sourceRefId) ? job.sourceRefId : null }
            ],
            company: job.company
          }).lean();

          // Strategy 1 (multi-item): direct saleId + saleItemId carried on the
          // QC job / rejected ProductionOrder
          let linkedSale = null;
          let saleItemId = job.saleItemId || linkedProdOrder?.saleItemId || null;
          const directSaleId = job.saleId || linkedProdOrder?.saleId || null;
          if (directSaleId) {
            linkedSale = await Sale.findById(directSaleId);
          }

          // Strategy 2 (legacy): parse "Ref: <invoice/saleId>" from the notes
          if (!linkedSale && linkedProdOrder?.notes) {
            const notesRefMatch = linkedProdOrder.notes.match(/Ref:\s*(\S+)/);
            // Multi-item refs look like "INV#<saleItemId>" — split them apart
            const rawRef = notesRefMatch ? notesRefMatch[1] : null;
            const saleRef = rawRef ? rawRef.split('#')[0] : null;
            if (rawRef && rawRef.includes('#') && !saleItemId) {
              const parts = rawRef.split('#');
              if (/^[0-9a-fA-F]{24}$/.test(parts[1])) saleItemId = parts[1];
            }
            if (saleRef) {
              linkedSale = await Sale.findOne({
                $or: [
                  { invoiceNumber: saleRef },
                  { _id: /^[0-9a-fA-F]{24}$/.test(saleRef) ? saleRef : null }
                ]
              });
            }
          }

          if (linkedSale) {
            const perItem = await setSaleItemStatus(linkedSale, saleItemId, 'Approved from QC', { isAvailableInInventory: 'Available', qty: job.quantity });
            console.log(`[QC Approval - QC_Rejected] Sale ${linkedSale._id} → Approved from QC${perItem ? ` (item ${saleItemId})` : ' (sale-level)'}. Ready for dispatch.`);
          }
        } catch (e) { console.error('❌ Error updating Sale on QC_Rejected approval:', e); }

      } else if (job.source === 'Stock') {
        // Stock production — qty added to inventory above, no sale/dispatch update needed
        console.log(`[QC Approval - Stock] Inventory updated. No sale/dispatch update.`);

      } else if (job.source === 'Purchase') {
        // Purchase source — update storeQCStatus on linked sale. Context
        // (PurchaseRequest + Sale) was already resolved above in the
        // inventory-vs-dispatch split; re-resolve only if that branch was
        // skipped for some reason.
        try {
          const { pr, sale: salePurch } = purchaseSaleCtx || await resolvePurchaseSaleContext(job);

          console.log(`[QC Approval - Purchase] PR lookup result:`, pr ? `Found PR ${pr.requestId}, storeOrderId: ${pr.storeOrderId}` : 'Not found');

          if (pr && pr.storeOrderId) {
            if (salePurch) {
              const isMachine = await isMachineJobItem(job, job.company);
              const newStatus = isMachine ? 'Approved from QC' : 'Purchase Completed';
              // Multi-item: the Purchase Request carries the exact sale item
              const saleItemId = pr.saleItemId || job.saleItemId || null;
              // job.quantity was already shrunk above to just the
              // dispatch-bound portion when Purchase bought more than this
              // sale item needed, so approvedQty only accumulates that much.
              const perItem = await setSaleItemStatus(salePurch, saleItemId, newStatus, { qty: job.quantity });
              console.log(`✅ [QC Approval - Purchase ${isMachine ? 'Machine' : 'Material'}] '${newStatus}' for Sale ${salePurch._id}${perItem ? ` (item ${saleItemId})` : ' (sale-level)'}`);
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
        try {
          const { createQCRejectedPurchaseExchange } = await import('./purchaseExchangeController.js');
          await createQCRejectedPurchaseExchange(job, req.user);
          console.log(`✅ [QC Rejection] Created purchase exchange for rejected purchase item: ${job.itemName}`);
        } catch (exchangeError) {
          console.error('❌ Error creating purchase exchange for rejected purchase item:', exchangeError);
        }
      } else {
        if (job.source === 'Store') {
          // Store sent this item straight to QC (e.g. a Purchase/Manufacturing
          // Machine already sitting in stock) — restore the qty to inventory
          // and let Store re-route it via Check Inventory (reactivated below
          // since lastRejectionSource is recorded as 'Store'). No Production
          // rework order: there was never a production run behind this item.
          await restoreStoreInventoryQty(job, job.quantity || 1);
        } else {
          // A FULL reject of a Production-lineage job no longer spins up a
          // brand-new order and a separate Rework/Repair decision (that
          // whole system is retired, 2026-09-02) — Production can already
          // see exactly which checklist item failed right on the same
          // order's Final Testing step, so it just reopens that same order
          // for them to fix and resubmit. Partial rejects (job.quantity >
          // job's rejected slice, handled earlier in this function) are a
          // narrower, unaddressed case and still use the old
          // createRejectedProductionOrder path below them for now.
          try {
            await reopenFinalTestingForRejection(job, req.user);
            console.log(`✅ [QC Rejection] Reopened Final Testing on the original order for: ${job.itemName}`);
          } catch (prodError) {
            console.error('❌ Error reopening Final Testing for rejected item:', prodError);
          }
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
            // Multi-item: only the rejected item flips to 'Rejected from QC';
            // other items of the order keep their own progress.
            let itemIdForReject = job.saleItemId;
            if (!itemIdForReject && (job.source === 'Production' || job.source === 'QC_Rejected') && job.sourceRefId) {
              try {
                const srcProd = await ProductionOrder.findOne({ orderId: job.sourceRefId, company: job.company })
                  .select('saleItemId').lean();
                itemIdForReject = srcProd?.saleItemId || null;
              } catch (_) { /* fall back to sale-level */ }
            }
            const perItem = await setSaleItemStatus(saleRej, itemIdForReject, 'Rejected from QC', { rejectionSource: job.source });
            console.log(`✅ [QC Rejection] 'Rejected from QC' for Sale ${saleRej._id}${perItem ? ` (item ${itemIdForReject})` : ' (sale-level)'}`);
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

// Reopens the SAME original order's Final Testing step for a full QC
// rejection of a Production-lineage job (source Production/Stock/
// QC_Rejected) — replaces the old "spin up a brand-new QC_Rejected order,
// Production decides Rework vs Repair" system for this case (retired
// 2026-09-02). Resets every unit's Final Testing (main + extraUnits — a
// reject means something about the assembled build failed, and nothing
// tracks which specific physical unit that was, so all of them go back to
// "needs re-testing" rather than guessing) back to 'In Progress' so
// FinalChecklistPanel/markProcessComplete's own gate picks the order back
// up exactly where Production left off — the checklist itself (job.checklist)
// isn't touched here at all, it already shows which row(s) failed.
async function reopenFinalTestingForRejection(qcJob, user) {
  if (!qcJob.sourceRefId) return;
  const order = await ProductionOrder.findOne({ orderId: qcJob.sourceRefId, company: qcJob.company });
  if (!order) return;

  const reopenUnit = (procs) => {
    if (!procs?.length) return;
    const finalStep = procs[procs.length - 1];
    finalStep.status = 'In Progress';
    finalStep.qcStatus = 'Rejected';
    finalStep.reworks.push({
      date: new Date().toISOString().split('T')[0],
      reason: qcJob.failReason || 'QC rejected the Final Check',
      rejectedBy: user.fullName || user.username || 'QC',
    });
  };
  reopenUnit(order.processes);
  (order.extraUnits || []).forEach(u => reopenUnit(u.processes));

  if (order.status === 'Completed') order.status = 'In Progress';
  await order.save();
}

// Helper function to create production order for rejected QC items
async function createRejectedProductionOrder(qcJob, user, qty) {
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

    // Resolve the real sales Order this rejected item traces back to, via the
    // saleId carried forward from the original Production Order → QC Job chain.
    let orderCode = null;
    if (qcJob.saleId) {
      try {
        const sourceSale = await Sale.findById(qcJob.saleId).populate('order', 'orderCode');
        orderCode = sourceSale?.order?.orderCode || null;
      } catch (saleErr) {
        console.error('Error resolving orderCode for rejected production order:', saleErr);
      }
    }

    // If the failed job came from Production, recover the sale-item link from
    // the originating Production Order (older Production QC jobs may not
    // carry saleItemId themselves).
    let saleItemId = qcJob.saleItemId || null;
    if (!saleItemId && qcJob.sourceRefId) {
      try {
        const srcProd = await ProductionOrder.findOne({ orderId: qcJob.sourceRefId, company: qcJob.company })
          .select('saleItemId').lean();
        saleItemId = srcProd?.saleItemId || null;
      } catch (_) { /* optional */ }
    }

    // Create production order for rejected item
    const productionOrder = await ProductionOrder.create({
      orderId: rejectedOrderId,
      orderCode,
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
      // Multi-item linkage: the rework stays tied to the exact order item and
      // rebuilds the full rejected quantity
      saleId: qcJob.saleId || null,
      saleItemId,
      orderQuantity: qty || qcJob.quantity || 1,
      company: qcJob.company,
      createdBy: user._id
    });

    return productionOrder;
  } catch (error) {
    console.error('Error creating rejected production order:', error);
    throw error;
  }
}

// Restore `qty` units to inventory for a Store-sourced job (partial or full
// reject) — the item was deducted from stock when it was sent to QC.
// Resolves a Purchase-sourced QC job back to its originating PurchaseRequest,
// the Sale it belongs to, and the exact Sale.items[] subdocument it fulfils —
// the same 3-strategy PR lookup the "link back to Sale" step already used,
// pulled into one place so the inventory-vs-dispatch surplus split and that
// step can share one resolution instead of querying it twice.
async function resolvePurchaseSaleContext(job) {
  const PurchaseRequest = (await import('../models/PurchaseRequest.js')).default;

  // Strategy 1: direct purchaseRequestId reference (most reliable)
  let pr = null;
  if (job.purchaseRequestId) {
    pr = await PurchaseRequest.findById(job.purchaseRequestId);
  }

  // Strategy 2: fall back to searching by requestId / itemCode
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

  // Strategy 3: search by PO number
  if (!pr && job.sourceRefId) {
    const Purchase = (await import('../models/Purchase.js')).default;
    const po = await Purchase.findOne({ purchaseOrderNumber: job.sourceRefId });
    if (po) {
      pr = await PurchaseRequest.findOne({ purchaseOrder: po._id });
    }
  }

  let sale = null;
  if (pr && pr.storeOrderId) {
    // storeOrderId can be an Order _id OR a Sale _id — try both
    sale = await Sale.findOne({ $or: [{ order: pr.storeOrderId }, { _id: pr.storeOrderId }] });
    if (!sale && pr.itemId) {
      sale = await Sale.findOne({
        $or: [
          { invoiceNumber: pr.itemId },
          { _id: /^[0-9a-fA-F]{24}$/.test(pr.itemId) ? pr.itemId : null }
        ]
      });
    }
  }

  const saleItemId = pr?.saleItemId || job.saleItemId || null;
  const saleItem = (sale && saleItemId) ? sale.items.id(saleItemId) : null;

  return { pr, sale, saleItem };
}

async function restoreStoreInventoryQty(job, qty) {
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
      inventoryItem.qty = prevQty + (qty || 1);
      await inventoryItem.save();
      console.log(`↩️ [QC Rejection - Store] Restored ${qty || 1} qty to ${inventoryItem.name}. New qty: ${inventoryItem.qty}`);
    }
  } catch (restoreErr) {
    console.error('❌ Error restoring inventory on QC rejection:', restoreErr);
  }
}

// Helper function to get delivery date
function getDeliveryDate(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split('T')[0];
}


// PUT /api/qc/jobs/:id/parts/:partCheckId/decision — QC's own verdict on one
// Sub Child Part, reviewing the Initial+Process rows Production already
// filled in (optionally correcting them here first). A Reject automatically
// reopens the part for Production to rework and resave — no separate manual
// "send back" action (confirmed 2026-09-01); the part's own `status` stays
// 'Rejected' (not silently reset to 'Awaiting Production') so Production's
// panel can show it was bounced, and why.
export const decidePartCheck = async (req, res) => {
  try {
    // initial/process here are QC's OWN per-row verdicts only —
    // [{_id, qcStatus, qcRemarks}] — matched onto the part's existing rows
    // by _id. Production's own recorded fields (parameter/standardValue/
    // actualValue/status/remarks/type) are never touched by this endpoint,
    // by construction — QC reviews Production's self-check, it doesn't edit
    // it (confirmed 2026-09-02).
    const { decision, rejectReason, initial, process } = req.body;
    if (!['Approved', 'Rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'decision must be Approved or Rejected' });
    }
    if (decision === 'Rejected' && !rejectReason?.trim()) {
      return res.status(400).json({ success: false, message: 'rejectReason is required when rejecting a part' });
    }

    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'QC job not found' });
    const part = job.partChecks.id(req.params.partCheckId);
    if (!part) return res.status(404).json({ success: false, message: 'Part not found on this job' });
    if (part.status !== 'QC Pending') {
      return res.status(400).json({ success: false, message: `This part isn't awaiting QC review (currently ${part.status}).` });
    }

    const applyQcVerdicts = (rows, updates) => {
      if (!Array.isArray(updates)) return;
      const byId = new Map(updates.map(u => [String(u._id), u]));
      for (const row of rows) {
        const u = byId.get(String(row._id));
        if (!u) continue;
        if (u.qcStatus !== undefined) row.qcStatus = u.qcStatus;
        if (u.qcRemarks !== undefined) row.qcRemarks = u.qcRemarks;
        if (u.qcStatus === 'Fail' && !String(u.qcRemarks || '').trim()) {
          throw Object.assign(new Error(`QC remarks are required for a failed row ("${row.parameter}").`), { status: 400 });
        }
      }
    };
    applyQcVerdicts(part.initial, initial);
    applyQcVerdicts(part.process, process);

    const stillPending = [...part.initial, ...part.process].some(c => c.qcStatus === 'Pending');
    if (stillPending) {
      return res.status(400).json({ success: false, message: 'Every checklist item must be marked Pass or Fail before a decision.' });
    }

    part.status = decision;
    part.qcBy = req.user.fullName || req.user.username || 'QC';
    part.qcDate = today();
    part.rejectReason = decision === 'Rejected' ? rejectReason.trim() : '';

    await job.save();
    res.json({ success: true, data: part });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

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



// PUT /api/qc/jobs/:id/sync-rd — manual re-sync. getQCJob already pulls this
// automatically the first time a job is opened (lazy, see its own comment)
// so this button is no longer the primary mechanism — it's now for the one
// case that needs a manual trigger: R&D added/changed a master-checklist row
// AFTER this job's checklist was already pulled, and QC wants the refresh
// without waiting for a brand new job. `force: true` is what makes this
// actually overwrite an already-populated checklist instead of no-op'ing
// like the automatic pull does.
export const syncRDToQCJob = async (req, res) => {
  try {
    const qcJob = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!qcJob) return res.status(404).json({ success: false, message: 'QC job not found' });

    // Same rule as getQCJob above: a manufactured job's Final checklist
    // isn't QC's to pull (even manually) until Production has actually
    // submitted it.
    if (qcJob.partChecks.length > 0 && !qcJob.finalCheckFilledAt) {
      return res.status(400).json({ success: false, message: 'Production hasn\'t submitted the Final Testing checklist yet — nothing to pull.' });
    }

    const changed = await ensureFlatChecklist(qcJob, req.user.companyId, { force: true });
    if (!changed) {
      return res.status(404).json({ success: false, message: `No configured checklist found for "${qcJob.itemName}".` });
    }
    await qcJob.save();
    res.json({ success: true, message: 'Checklist synced.', data: qcJob });
  } catch (error) {
    console.error('❌ Error syncing checklist to QC job:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
