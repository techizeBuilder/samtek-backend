import mongoose from 'mongoose';
import PackagingJob from '../models/PackagingJob.js';
import DispatchOrder from '../models/DispatchOrder.js';
import ProductionOrder from '../models/ProductionOrder.js';
import QCJob from '../models/QCJob.js';
import AdminSettings from '../models/AdminSettings.js';
import notificationService from '../services/notificationService.js';
import Sale from '../models/Sale.js';
import Order from '../models/Order.js';
import { resolveSalesOrderCodeForQCJob } from '../utils/resolveSalesOrderCode.js';
import { getOrderItemsReadiness } from '../services/storeFlowService.js';

const JOB_STATUSES = ['Pending', 'In Progress', 'Packed', 'Dispatched'];

// Enriches packaging jobs with NOC/gate-pass/customer info from the linked
// sales Order + Sale — shared by the paginated (getPackagingJobs) and bounded
// active-work (getActivePackagingJobs) endpoints so both stay consistent
// without duplicating this lookup logic.
async function enrichPackagingJobs(jobs, companyId) {
  return Promise.all(jobs.map(async (job) => {
    let nocStatus = 'Pending';
    let gatePassStatus = 'Pending';
    let customerName = '';
    let customerContact = '';
    let invoiceNumber = '';

    if (job.orderId) {
      // orderId is actually the orderCode string
      const order = await Order.findOne({ orderCode: job.orderId, companyId }).populate('customer');
      if (order) {
        customerName = order.customer?.name || '';
        customerContact = order.customer?.mobile || '';

        const orderSales = await Sale.find({ order: order._id });
        if (orderSales.length) {
          const realSale = orderSales.find(s => !s.isPlaceholder && s.invoiceType === 'Pakka')
            || orderSales.find(s => !s.isPlaceholder)
            || orderSales[0];
          nocStatus = realSale.gatePass?.nocStatus || 'Pending';
          gatePassStatus = realSale.gatePass?.status || 'Pending';
          invoiceNumber = (orderSales.find(s => !s.isPlaceholder))?.invoiceNumber || '';
        }
      }
    }

    return { ...job, nocStatus, gatePassStatus, customerName, customerContact, invoiceNumber };
  }));
}

// Enriches dispatch orders with gate-pass data + the order's full item list —
// shared by the paginated (getDispatchOrders) and bounded active-work
// (getActiveDispatchOrders) endpoints.
async function enrichDispatchOrdersList(orders, companyId) {
  const itemsCache = new Map(); // orderCode → orderItems summary
  return Promise.all(orders.map(async (order) => {
    if (!order.orderId) return order;
    try {
      let orderItems = null;
      if (itemsCache.has(order.orderId)) {
        orderItems = itemsCache.get(order.orderId);
      } else {
        try {
          const r = await getOrderItemsReadiness(order.orderId, companyId);
          orderItems = r.found
            ? r.items.map(i => ({ name: i.name, qty: i.qty, status: i.status, ready: i.ready }))
            : null;
        } catch (e) { orderItems = null; }
        itemsCache.set(order.orderId, orderItems);
      }

      const matchedOrder = await Order.findOne({ orderCode: order.orderId, companyId }).select('_id').lean();
      if (!matchedOrder) return { ...order, orderItems };

      const matchedSale = await Sale.findOne({
        order: matchedOrder._id,
        companyId,
        'gatePass.status': 'Generated'
      }).select('gatePass').lean();
      if (!matchedSale?.gatePass) return { ...order, orderItems };

      return {
        ...order,
        orderItems,
        gatePassVehicleNumber: matchedSale.gatePass.vehicleNumber || '',
        gatePassDriverName: matchedSale.gatePass.driverName || '',
        gatePassContactNumber: matchedSale.gatePass.contactNumber || '',
        gatePassNumber: matchedSale.gatePass.gatePassNumber || '',
        gatePassGenerated: true
      };
    } catch (e) {
      return order;
    }
  }));
}

// Categories whose physical units each get their own packaging job + serial
// number. Anything else (accessories/materials) packs as one job with qty.
const PER_UNIT_CATEGORIES = ['purchase machine', 'manufacturing machine', 'finished good'];

const now = () => new Date().toISOString();

// ── ID Generators ─────────────────────────────────────────────────────────────

// Short company suffix — last 6 chars of companyId ObjectId (globally unique enough)
// ObjectId is a 24-char hex string; last 6 chars give ~16M combinations — collision is practically impossible
function companySuffix(companyId) {
  return String(companyId).slice(-6).toUpperCase();
}

async function generateJobId(companyId) {
  const year = new Date().getFullYear();
  const suffix = companySuffix(companyId);
  const prefix = `PKG-${year}-${suffix}-`;

  const last = await PackagingJob.findOne(
    { company: companyId, jobId: { $regex: `^${prefix}` } },
    { jobId: 1 }
  ).sort({ jobId: -1 }).lean();

  let next = 1;
  if (last?.jobId) {
    const num = parseInt(last.jobId.replace(prefix, ''), 10);
    if (!isNaN(num)) next = num + 1;
  }

  // Collision retry loop (handles race conditions)
  let attempts = 0;
  while (attempts < 20) {
    const candidate = `${prefix}${String(next + attempts).padStart(3, '0')}`;
    const exists = await PackagingJob.exists({ jobId: candidate }); // global check
    if (!exists) return candidate;
    attempts++;
  }
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

async function generateSerialNumber(companyId) {
  const year = new Date().getFullYear();
  const suffix = companySuffix(companyId);
  const prefix = `SN-${year}-${suffix}-`;

  const last = await PackagingJob.findOne(
    { company: companyId, serialNumber: { $regex: `^${prefix}` } },
    { serialNumber: 1 }
  ).sort({ serialNumber: -1 }).lean();

  let next = 1;
  if (last?.serialNumber) {
    const num = parseInt(last.serialNumber.replace(prefix, ''), 10);
    if (!isNaN(num)) next = num + 1;
  }

  // Collision retry loop
  let attempts = 0;
  while (attempts < 20) {
    const candidate = `${prefix}${String(next + attempts).padStart(4, '0')}`;
    const exists = await PackagingJob.exists({ serialNumber: candidate }); // global check
    if (!exists) return candidate;
    attempts++;
  }
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

async function generateDispatchId(companyId) {
  const year = new Date().getFullYear();
  const suffix = companySuffix(companyId);
  const prefix = `DIS-${year}-${suffix}-`;

  const last = await DispatchOrder.findOne(
    { company: companyId, dispatchId: { $regex: `^${prefix}` } },
    { dispatchId: 1 }
  ).sort({ dispatchId: -1 }).lean();

  let next = 1;
  if (last?.dispatchId) {
    const num = parseInt(last.dispatchId.replace(prefix, ''), 10);
    if (!isNaN(num)) next = num + 1;
  }

  let attempts = 0;
  while (attempts < 20) {
    const candidate = `${prefix}${String(next + attempts).padStart(3, '0')}`;
    const exists = await DispatchOrder.exists({ dispatchId: candidate }); // global check
    if (!exists) return candidate;
    attempts++;
  }
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

function generateTrackingId() {
  return `TRK-${Date.now().toString(36).toUpperCase()}`;
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────

export const getDashboard = async (req, res) => {
  try {
    const cid = req.user.companyId;

    // Get IDs already assigned to a packaging job
    const existingJobOrderIds = await PackagingJob.distinct('productionOrderId', { company: cid, productionOrderId: { $ne: null } });
    const existingQCJobIds = await PackagingJob.distinct('qcJobId', { company: cid, qcJobId: { $ne: null } });

    const [
      prodReadyCount,
      qcReadyCount,
      packagingPending,
      packagingInProgress,
      packagingPacked,
      dispatchReady,
      dispatchInTransit,
      dispatchDelivered,
      dispatchClosed,
    ] = await Promise.all([
      // Production orders QC-approved and not yet in a packaging job
      ProductionOrder.countDocuments({
        company: cid,
        status: 'Completed',
        'processes': { $elemMatch: { step: 'Final Testing', qcStatus: 'Approved' } },
        _id: { $nin: existingJobOrderIds },
      }),
      // QC jobs approved and not yet in a packaging job
      QCJob.countDocuments({
        company: cid,
        status: 'Approved',
        source: { $ne: 'Purchase' },
        _id: { $nin: existingQCJobIds },
      }),
      PackagingJob.countDocuments({ company: cid, status: 'Pending' }),
      PackagingJob.countDocuments({ company: cid, status: 'In Progress' }),
      PackagingJob.countDocuments({ company: cid, status: 'Packed' }),
      DispatchOrder.countDocuments({ company: cid, status: 'Ready' }),
      DispatchOrder.countDocuments({ company: cid, status: { $in: ['Dispatched', 'In Transit'] } }),
      DispatchOrder.countDocuments({ company: cid, status: 'Delivered' }),
      DispatchOrder.countDocuments({ company: cid, status: 'Closed' }),
    ]);

    const readyForPackaging = prodReadyCount + qcReadyCount;

    // Recent dispatches (last 5)
    const recentDispatches = await DispatchOrder.find({ company: cid })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    // Delayed deliveries: In Transit with expectedDeliveryDate < today
    const today = new Date().toISOString().split('T')[0];
    const delayedDeliveries = await DispatchOrder.countDocuments({
      company: cid,
      status: { $in: ['Dispatched', 'In Transit'] },
      expectedDeliveryDate: { $lt: today },
    });

    res.json({
      success: true,
      data: {
        readyForPackaging,
        packaging: { pending: packagingPending, inProgress: packagingInProgress, packed: packagingPacked },
        dispatch: { ready: dispatchReady, inTransit: dispatchInTransit, delivered: dispatchDelivered, closed: dispatchClosed },
        delayedDeliveries,
        recentDispatches,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PACKAGING QUEUE ───────────────────────────────────────────────────────────

export const getReadyForPackaging = async (req, res) => {
  try {
    const cid = req.user.companyId;

    // Get IDs already assigned to a packaging job
    const existingQCJobIds = await PackagingJob.distinct('qcJobId', { company: cid, qcJobId: { $ne: null } });

    // Fetch approved QC Jobs:
    // - Either non-Purchase source (covers Store, Production, QC_Rejected)
    // - Or Purchase source where the category is a Purchase Machine or Manufacturing Machine
    //   NOTE: Also include Purchase jobs whose category may have been mis-stored (e.g. "Raw Material")
    //         but whose actual inventory item is a machine — we filter them below after item lookup.
    const qcJobsRaw = await QCJob.find({
      company: cid,
      status: 'Approved',
      source: { $ne: 'Stock' },   // Stock items go to inventory, never to dispatch
      _id: { $nin: existingQCJobIds }
    })
      .sort({ updatedAt: -1 })
      .lean();

    const { Item } = await import('../models/Inventory.js');
    const MACHINE_CATEGORIES = ['Purchase Machine', 'Manufacturing Machine'];

    // For Purchase source: keep only machine-category items (check DB item if category looks wrong)
    const qcJobs = await Promise.all(qcJobsRaw.map(async (job) => {
      if (job.source !== 'Purchase') return job; // non-purchase always included

      const catLower = (job.category || '').toLowerCase().trim();
      const isMachineCat = MACHINE_CATEGORIES.map(c => c.toLowerCase()).includes(catLower);
      if (isMachineCat) return job; // category already correct

      // Category may be wrong (e.g. stored as "Raw Material") — verify via actual inventory item
      try {
        let inventoryItem = null;
        if (job.itemCode && /^[0-9a-fA-F]{24}$/.test(job.itemCode)) {
          inventoryItem = await Item.findById(job.itemCode).lean();
        }
        if (!inventoryItem && job.itemCode) {
          inventoryItem = await Item.findOne({ code: job.itemCode, store: cid.toString() }).lean();
        }
        if (!inventoryItem && job.itemName) {
          inventoryItem = await Item.findOne({ name: job.itemName, store: cid.toString() }).lean();
        }
        if (inventoryItem && MACHINE_CATEGORIES.includes(inventoryItem.category)) {
          console.log(`[PackagingQueue] Purchase QC job ${job.qcJobId} has category '${job.category}' but item is '${inventoryItem.category}' — including in packaging queue`);
          return { ...job, category: inventoryItem.category }; // return with corrected category
        }
      } catch (e) {
        console.error('[PackagingQueue] Error verifying item category for QC job:', job.qcJobId, e);
      }

      return null; // not a machine — exclude from packaging queue
    }));

    // Remove nulls (non-machine Purchase items filtered out)
    const filteredQcJobs = qcJobs.filter(Boolean);

    // Map QCJobs to the format expected by the frontend packaging queue page
    // and resolve sales order code for proper tracking
    const readinessCache = new Map(); // orderCode → readiness (avoid repeat lookups)
    const qcMapped = await Promise.all(filteredQcJobs.map(async (job) => {
      const salesOrderCode = await resolveSalesOrderCodeForQCJob(job, cid);
      const orderIdVal = salesOrderCode || job.itemCode || job.qcJobId || 'Store Order';
      const machineCodeVal = job.sourceRefId || 'N/A';

      // 🚧 Multi-item readiness: the create button is locked until every item
      // of the order is QC-approved
      let readiness = null;
      if (salesOrderCode) {
        if (readinessCache.has(salesOrderCode)) {
          readiness = readinessCache.get(salesOrderCode);
        } else {
          try {
            const r = await getOrderItemsReadiness(salesOrderCode, cid);
            readiness = r.found ? {
              orderCode: r.orderCode,
              allReady: r.allReady,
              readyCount: r.readyCount,
              totalCount: r.totalCount,
              items: r.items.map(i => ({ name: i.name, qty: i.qty, status: i.status, ready: i.ready }))
            } : null;
          } catch (e) {
            console.error('Readiness lookup failed for', salesOrderCode, e.message);
          }
          readinessCache.set(salesOrderCode, readiness);
        }
      }

      // How many packaging job units does this entry represent, and how many exist?
      const isPerUnit = job.source === 'Production'
        || PER_UNIT_CATEGORIES.includes((job.category || '').toLowerCase().trim());
      const qty = Math.max(1, Number(job.quantity) || 1);
      const unitsTotal = isPerUnit ? qty : 1;
      const unitsCreated = await PackagingJob.countDocuments({ qcJobId: job._id, company: cid });

      return {
        _id: job._id,
        isQCJob: true,
        orderId: orderIdVal,
        salesOrderCode: salesOrderCode,
        machineCode: machineCodeVal,
        machineName: job.itemName || 'Store Item',
        quantity: qty,
        unitsTotal,
        unitsCreated,
        saleItemId: job.saleItemId || null,
        readiness,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        processes: [
          {
            step: 'Final Testing',
            qcStatus: 'Approved'
          }
        ]
      };
    }));

    // Sort the combined array by updatedAt descending (latest approved from QA first)
    qcMapped.sort((a, b) => {
      const dateA = a.updatedAt ? new Date(a.updatedAt) : new Date(a.createdAt || 0);
      const dateB = b.updatedAt ? new Date(b.updatedAt) : new Date(b.createdAt || 0);
      return dateB - dateA;
    });

    res.json({ success: true, data: qcMapped });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PACKAGING JOBS ────────────────────────────────────────────────────────────

export const getPackagingJobs = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { page = 1, limit = 20, search, status } = req.query;
    const skip = (page - 1) * limit;

    const query = { company: companyId };
    if (status && status !== 'all' && JOB_STATUSES.includes(status)) {
      query.status = status;
    }
    if (search) {
      query.$or = [
        { jobId: { $regex: search, $options: 'i' } },
        { orderId: { $regex: search, $options: 'i' } },
        { machineCode: { $regex: search, $options: 'i' } },
        { machineName: { $regex: search, $options: 'i' } },
      ];
    }

    const [jobs, total, statusAgg] = await Promise.all([
      PackagingJob.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      PackagingJob.countDocuments(query),
      // Global status breakdown (not scoped to the current search/status
      // filter) — same "always show all statuses' counts" stat-bar
      // convention used by Orders in the production module.
      PackagingJob.aggregate([
        { $match: { company: new mongoose.Types.ObjectId(companyId) } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const enrichedJobs = await enrichPackagingJobs(jobs, companyId);
    const countFrom = (key) => (statusAgg.find(a => a._id === key)?.count) || 0;
    const summary = {
      all: JOB_STATUSES.reduce((sum, k) => sum + countFrom(k), 0),
      Pending: countFrom('Pending'),
      'In Progress': countFrom('In Progress'),
      Packed: countFrom('Packed'),
      Dispatched: countFrom('Dispatched'),
    };

    res.json({
      success: true,
      data: {
        jobs: enrichedJobs,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
        summary,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Bounded "current work" feed for board-style pages (Dispatch Planning) —
// non-Dispatched jobs, plus anything dispatched within the last 7 days so a
// multi-machine order's just-dispatched siblings don't vanish mid-workflow.
// Unlike getPackagingJobs above this isn't paginated: it's bounded by how
// much packaging work is actually in flight, not by total job history.
export const getActivePackagingJobs = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const jobs = await PackagingJob.find({
      company: companyId,
      $or: [
        { status: { $ne: 'Dispatched' } },
        { updatedAt: { $gte: sevenDaysAgo } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const enrichedJobs = await enrichPackagingJobs(jobs, companyId);
    res.json({ success: true, data: enrichedJobs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createPackagingJob = async (req, res) => {
  try {
    const { productionOrderId, qcJobId, orderId, machineCode, machineName, packingType, notes } = req.body;
    if (!productionOrderId && !qcJobId) {
      return res.status(400).json({ success: false, message: 'productionOrderId or qcJobId is required' });
    }
    if (!orderId || !machineCode || !machineName) {
      return res.status(400).json({ success: false, message: 'orderId, machineCode, machineName are required' });
    }

    let actualProdOrderId = productionOrderId;
    let actualQcJobId = qcJobId;

    // Intelligent fallback check: if productionOrderId actually belongs to a QCJob
    if (productionOrderId && !qcJobId) {
      const isQC = await QCJob.exists({ _id: productionOrderId });
      if (isQC) {
        actualQcJobId = productionOrderId;
        actualProdOrderId = undefined;
      }
    }

    // ── Multi-item: work out how many physical units this source packs ──
    // Machines pack one job per unit (each with its own serial number);
    // non-machine items pack as a single job carrying the quantity.
    let sourceUnits = 1;       // number of packaging jobs to create in total
    let jobQuantity = 1;       // quantity stamped on each job
    let sourceSaleItemId = null;

    let srcProdOrder = null;
    let srcQcJob = null;
    if (actualProdOrderId) {
      srcProdOrder = await ProductionOrder.findById(actualProdOrderId)
        .select('saleId saleItemId orderQuantity').lean();
      sourceUnits = Math.max(1, Number(srcProdOrder?.orderQuantity) || 1);
      sourceSaleItemId = srcProdOrder?.saleItemId || null;
    } else if (actualQcJobId) {
      srcQcJob = await QCJob.findById(actualQcJobId)
        .select('saleId purchaseRequestId saleItemId quantity category').lean();
      sourceSaleItemId = srcQcJob?.saleItemId || null;
      const qty = Math.max(1, Number(srcQcJob?.quantity) || 1);
      const isPerUnit = PER_UNIT_CATEGORIES.includes((srcQcJob?.category || '').toLowerCase().trim());
      if (isPerUnit) {
        sourceUnits = qty;      // N machines → N jobs, 1 unit each
      } else {
        sourceUnits = 1;        // 1 job carrying the full qty
        jobQuantity = qty;
      }
    }

    // Duplicate protection (replaces the old unique index): allow up to
    // sourceUnits jobs per source, then refuse.
    const dupFilter = actualProdOrderId
      ? { productionOrderId: actualProdOrderId, company: req.user.companyId }
      : { qcJobId: actualQcJobId, company: req.user.companyId };
    const existingCount = await PackagingJob.countDocuments(dupFilter);
    if (existingCount >= sourceUnits) {
      return res.status(400).json({
        success: false,
        message: sourceUnits > 1
          ? `All ${sourceUnits} packaging jobs already exist for this order item`
          : 'Packaging job already exists for this order'
      });
    }

    // Resolve the actual sales Order.orderCode to store in orderId field
    // This is critical: Accounts pages (NOC Request, Packed Orders) match on Order.orderCode
    // so PackagingJob.orderId MUST be the sales orderCode (e.g. "ORD-2024-XXX-001"), not the MFG ID
    let resolvedOrderId = orderId;
    try {
      const Order = (await import('../models/Order.js')).default;
      if (srcProdOrder?.saleId) {
        const linkedSale = await Sale.findById(srcProdOrder.saleId).select('order').lean();
        if (linkedSale?.order) {
          const salesOrder = await Order.findById(linkedSale.order).select('orderCode').lean();
          if (salesOrder?.orderCode) resolvedOrderId = salesOrder.orderCode;
        }
      } else if (srcQcJob?.saleId) {
        const linkedSale = await Sale.findById(srcQcJob.saleId).select('order').lean();
        if (linkedSale?.order) {
          const salesOrder = await Order.findById(linkedSale.order).select('orderCode').lean();
          if (salesOrder?.orderCode) resolvedOrderId = salesOrder.orderCode;
        }
      } else if (srcQcJob?.purchaseRequestId) {
        const PurchaseRequest = (await import('../models/PurchaseRequest.js')).default;
        const pr = await PurchaseRequest.findById(srcQcJob.purchaseRequestId).lean();
        if (pr && pr.storeOrderId) {
          const salesOrder = await Order.findById(pr.storeOrderId).select('orderCode').lean();
          if (salesOrder?.orderCode) {
            resolvedOrderId = salesOrder.orderCode;
          } else {
            const sale = await Sale.findById(pr.storeOrderId).select('order').lean();
            if (sale?.order) {
              const salesOrder2 = await Order.findById(sale.order).select('orderCode').lean();
              if (salesOrder2?.orderCode) resolvedOrderId = salesOrder2.orderCode;
            }
          }
        }
        if (!sourceSaleItemId && pr?.saleItemId) sourceSaleItemId = pr.saleItemId;
      }
    } catch (resolveErr) {
      console.warn('Could not resolve salesOrderCode for packaging job, using provided orderId:', resolveErr.message);
    }

    // 🚧 MULTI-ITEM GATE: packing for an order may only start once EVERY item
    // of that order is QC-approved (ready). Until then no packaging job can
    // be created — the queue shows what is still pending.
    try {
      const readiness = await getOrderItemsReadiness(resolvedOrderId, req.user.companyId);
      if (readiness.found && !readiness.allReady) {
        const pendingList = readiness.items
          .filter(i => !i.ready)
          .map(i => `${i.name} ×${i.qty} — ${i.status}`);
        return res.status(400).json({
          success: false,
          code: 'ORDER_NOT_READY',
          message: `Packing blocked: order ${resolvedOrderId} has ${readiness.totalCount - readiness.readyCount} of ${readiness.totalCount} item(s) not yet QC-approved. Pending: ${pendingList.join('; ')}`,
          readiness: {
            orderCode: readiness.orderCode,
            readyCount: readiness.readyCount,
            totalCount: readiness.totalCount,
            items: readiness.items
          }
        });
      }
    } catch (gateErr) {
      console.error('Error checking order readiness for packaging gate:', gateErr);
    }

    // Create the remaining unit jobs (machines: one per unit with its own
    // serial; non-machines: a single job carrying the quantity)
    const unitsToCreate = sourceUnits - existingCount;
    const createdJobs = [];
    for (let u = 0; u < unitsToCreate; u++) {
      const jobId = await generateJobId(req.user.companyId);
      const serialNumber = await generateSerialNumber(req.user.companyId);

      const jobData = {
        jobId,
        orderId: resolvedOrderId,   // ← sales orderCode (e.g. "ORD-..."), resolved above
        machineCode,
        machineName,
        serialNumber,
        unitIndex: existingCount + u + 1,
        quantity: jobQuantity,
        saleItemId: sourceSaleItemId || null,
        packingType: packingType || 'Wooden Packing',
        notes: notes || '',
        company: req.user.companyId,
        createdBy: req.user._id,
      };
      if (actualProdOrderId) jobData.productionOrderId = actualProdOrderId;
      if (actualQcJobId) jobData.qcJobId = actualQcJobId;

      const job = await PackagingJob.create(jobData);
      createdJobs.push(job);
    }

    // 🔔 Notify Packing Head & Employee about new job(s)
    try {
      const first = createdJobs[0];
      await notificationService.triggerPackingNotification({
        action: 'ready_for_packing',
        data: {
          jobId: first._id,
          batchNo: createdJobs.length > 1 ? `${first.jobId} (+${createdJobs.length - 1} more)` : first.jobId,
          orderCode: first.orderId,
          machineName: first.machineName
        },
        targetCompanyId: first.company,
      });
    } catch (e) { console.error('Ready for packing notification error:', e); }

    res.status(201).json({
      success: true,
      data: createdJobs[0],
      jobs: createdJobs,
      unitsCreated: createdJobs.length,
      unitsTotal: sourceUnits
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updatePackingType = async (req, res) => {
  try {
    const { packingType, notes } = req.body;
    const job = await PackagingJob.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { packingType, notes },
      { new: true }
    );
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const startPacking = async (req, res) => {
  try {
    const job = await PackagingJob.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, status: 'Pending' },
      { status: 'In Progress', packingStartTime: now() },
      { new: true }
    );
    if (!job) return res.status(404).json({ success: false, message: 'Job not found or not in Pending state' });
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateChecklist = async (req, res) => {
  try {
    // Checklist items are admin-defined (Admin Settings > General > Dispatch > Manage
    // Checklist), so keys are dynamic — merge whatever the client sends into the
    // existing checklist object instead of destructuring fixed field names.
    const job = await PackagingJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    job.checklist = { ...(job.checklist || {}), ...req.body };
    job.markModified('checklist');
    await job.save();
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const completePacking = async (req, res) => {
  try {
    const { photoProofUrl } = req.body;
    const job = await PackagingJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const settings = await AdminSettings.findOne({ companyId: req.user.companyId });
    const checklistItems = settings?.dispatchChecklist || [];
    const cl = job.checklist || {};
    const allDone = checklistItems.every(item => cl[item._id.toString()]);
    if (!allDone) {
      return res.status(400).json({ success: false, message: 'All checklist items must be completed before marking packing as complete' });
    }

    job.status = 'Packed';
    job.packingCompleteTime = now();
    if (photoProofUrl) job.photoProofUrl = photoProofUrl;
    await job.save();

    // 🔔 Notify Dispatch team that packing is done
    try {
      await notificationService.triggerPackingNotification({
        action: 'packing_completed',
        data: { jobId: job._id, dcno: job.jobId, orderCode: job.orderId, machineName: job.machineName },
        targetCompanyId: job.company,
      });
    } catch (e) { console.error('Packing completed notification error:', e); }

    // 🔔 Notify Accounts for NOC + Packed Order Payment
    try {
      await notificationService.triggerAccountsNotification({
        action: 'packed_order_payment_pending',
        data: {
          jobId: job._id,
          batchNo: job.jobId,
          orderCode: job.orderId,
          machineName: job.machineName,
          message: 'Packing complete. NOC and final payment collection required before dispatch.',
        },
        targetCompanyId: job.company,
      });
    } catch (e) { console.error('Accounts NOC payment notification error:', e); }

    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DISPATCH ORDERS ───────────────────────────────────────────────────────────

export const getDispatchOrders = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { page = 1, limit = 20, search, status, scope } = req.query;
    const skip = (page - 1) * limit;

    const filter = { company: companyId };
    // `scope=history` is what Dispatch History uses — constrains to the two
    // terminal states, then `status` (if given) narrows to just one of them.
    if (scope === 'history') {
      filter.status = { $in: ['Delivered', 'Closed'] };
    }
    if (status && status !== 'all') {
      filter.status = status;
    }
    if (search) {
      filter.$or = [
        { dispatchId: { $regex: search, $options: 'i' } },
        { orderId: { $regex: search, $options: 'i' } },
        { machineCode: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
        { trackingId: { $regex: search, $options: 'i' } },
      ];
    }

    const [orders, total] = await Promise.all([
      DispatchOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      DispatchOrder.countDocuments(filter),
    ]);

    const enriched = await enrichDispatchOrdersList(orders, companyId);

    const pagination = { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) };
    let summary;
    if (scope === 'history') {
      // Counts within the history scope (all/Delivered/Closed), independent
      // of the current search text — backs Dispatch History's filter tabs.
      const [delivered, closed] = await Promise.all([
        DispatchOrder.countDocuments({ company: companyId, status: 'Delivered' }),
        DispatchOrder.countDocuments({ company: companyId, status: 'Closed' }),
      ]);
      summary = { all: delivered + closed, Delivered: delivered, Closed: closed };
    }

    res.json({ success: true, data: { orders: enriched, pagination, summary } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Bounded "current work" feed for board-style pages (Active Dispatches) —
// everything except Closed, which is the only true terminal state here
// ('Delivered' is still actionable until manually closed, so no time-based
// grace window is needed the way packaging jobs need one). Unlike
// getDispatchOrders above this isn't paginated: bounded by how much is
// actually in flight, not by total dispatch history.
export const getActiveDispatchOrders = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const orders = await DispatchOrder.find({ company: companyId, status: { $ne: 'Closed' } })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const enriched = await enrichDispatchOrdersList(orders, companyId);
    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createDispatchOrder = async (req, res) => {
  try {
    const {
      packagingJobId, packagingJobIds, orderId, machineCode, machineName, serialNumber,
      customerName, customerContact, deliveryAddress,
      transportType, plannedDispatchDate, expectedDeliveryDate,
      packingListNotes, notes,
    } = req.body;

    // The whole order dispatches as one wrapper action: the caller may send
    // `packagingJobIds` (every packed machine of the order) to create all
    // their DispatchOrder records in one request, or the legacy single
    // `packagingJobId` for a one-off job. Each machine still gets its own
    // DispatchOrder underneath (needed for serial-number-level tracking in
    // Active Dispatches / Dispatch History) — only the planning action itself
    // is now one entity.
    const jobIds = Array.isArray(packagingJobIds) && packagingJobIds.length
      ? [...new Set(packagingJobIds)]
      : (packagingJobId ? [packagingJobId] : []);

    if (!jobIds.length || !orderId) {
      return res.status(400).json({ success: false, message: 'packagingJobId(s) and orderId are required' });
    }

    // Verify every packaging job is in Packed state
    const jobs = await PackagingJob.find({ _id: { $in: jobIds }, company: req.user.companyId, status: 'Packed' });
    if (jobs.length !== jobIds.length) {
      return res.status(400).json({ success: false, message: 'One or more packaging jobs were not found or are not yet Packed' });
    }
    const job = jobs[0]; // representative job — all siblings share the same orderId

    // 🚧 MULTI-ITEM GATE: the whole order dispatches together. Block dispatch
    // planning until (a) every item of the order is QC-approved, and (b) every
    // packaging job of the order is Packed (none still Pending/In Progress).
    try {
      const readiness = await getOrderItemsReadiness(job.orderId, req.user.companyId);
      if (readiness.found && !readiness.allReady) {
        const pendingList = readiness.items
          .filter(i => !i.ready)
          .map(i => `${i.name} ×${i.qty} — ${i.status}`);
        return res.status(400).json({
          success: false,
          code: 'ORDER_NOT_READY',
          message: `Dispatch blocked: order ${job.orderId} still has item(s) not ready: ${pendingList.join('; ')}. The full order dispatches together.`,
          readiness: {
            orderCode: readiness.orderCode,
            readyCount: readiness.readyCount,
            totalCount: readiness.totalCount,
            items: readiness.items
          }
        });
      }

      const unpackedJobs = await PackagingJob.find({
        company: req.user.companyId,
        orderId: job.orderId,
        status: { $in: ['Pending', 'In Progress'] }
      }).select('jobId machineName status').lean();
      if (unpackedJobs.length > 0) {
        return res.status(400).json({
          success: false,
          code: 'ORDER_NOT_FULLY_PACKED',
          message: `Dispatch blocked: ${unpackedJobs.length} packaging job(s) of order ${job.orderId} are not Packed yet: ${unpackedJobs.map(j => `${j.jobId} (${j.machineName} — ${j.status})`).join('; ')}`
        });
      }
    } catch (gateErr) {
      console.error('Error checking order readiness for dispatch gate:', gateErr);
    }

    // No dispatch without an invoice: job.orderId holds the sales orderCode —
    // resolve it to an Order and require at least one REAL Sale (Pakka or
    // Kachha) already generated by Accounts. Store's internal placeholder
    // Sale (isPlaceholder: true) doesn't count — it's not a real invoice.
    // The invoice number is taken from that Sale, never trusted from the
    // client, so it can't be typed in manually.
    const Order = (await import('../models/Order.js')).default;
    let resolvedInvoiceNumber = '';
    if (job.orderId) {
      const linkedOrder = await Order.findOne({ orderCode: job.orderId, companyId: req.user.companyId }).select('_id').lean();
      if (linkedOrder) {
        const linkedSale = await Sale.findOne({ order: linkedOrder._id, companyId: req.user.companyId, isPlaceholder: { $ne: true } })
          .sort({ createdAt: -1 })
          .select('invoiceNumber')
          .lean();
        resolvedInvoiceNumber = linkedSale?.invoiceNumber || '';
      }
    }
    if (!resolvedInvoiceNumber) {
      return res.status(400).json({
        success: false,
        message: 'Invoice not generated for this order. Accounts must generate the invoice (Pakka/Kachha) before dispatch can be planned.'
      });
    }

    // Body-level machineCode/machineName/serialNumber overrides only make
    // sense for a single specific job — with several jobs each keeps its own.
    const useOverrides = jobs.length === 1;

    const dispatches = [];
    for (const j of jobs) {
      const dispatchId = await generateDispatchId(req.user.companyId);
      const trackingId = generateTrackingId();

      const dispatch = await DispatchOrder.create({
        dispatchId,
        packagingJobId: j._id,
        productionOrderId: j.productionOrderId || undefined,
        qcJobId: j.qcJobId || undefined,
        orderId,
        machineCode: (useOverrides && machineCode) || j.machineCode,
        machineName: (useOverrides && machineName) || j.machineName,
        serialNumber: (useOverrides && serialNumber) || j.serialNumber,
        saleItemId: j.saleItemId || null,
        quantity: j.quantity || 1,
        customerName: customerName || '',
        customerContact: customerContact || '',
        deliveryAddress: deliveryAddress || '',
        transportType: transportType || 'Transport Company',
        plannedDispatchDate: plannedDispatchDate || null,
        expectedDeliveryDate: expectedDeliveryDate || null,
        trackingId,
        invoiceNumber: resolvedInvoiceNumber,
        packingListNotes: packingListNotes || '',
        notes: notes || '',
        company: req.user.companyId,
        createdBy: req.user._id,
      });

      // Mark packaging job as Dispatched
      await PackagingJob.findByIdAndUpdate(j._id, { status: 'Dispatched' });
      dispatches.push(dispatch);
    }

    // 🔔 Notify Dispatch Head & Employee that dispatch order(s) are created —
    // one summary notification for the whole order, not one per machine.
    try {
      const first = dispatches[0];
      await notificationService.triggerDispatchNotification({
        action: 'ready_for_dispatch',
        data: {
          orderCode: first.orderId,
          dcno: dispatches.map(d => d.dispatchId).join(', '),
          customerName: first.customerName,
          dispatchOrderId: first._id,
          machineCount: dispatches.length,
        },
        targetCompanyId: first.company,
      });
    } catch (e) { console.error('Ready for dispatch notification error:', e); }

    res.status(201).json({ success: true, data: dispatches.length === 1 ? dispatches[0] : dispatches });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const executeDispatch = async (req, res) => {
  try {
    // Delivery documents are now captured at dispatch time (moved from confirmDelivery)
    const files = req.files || {};
    const nocFile = files.noc?.[0];
    const ewayBillFile = files.ewayBill?.[0];
    const invoiceFile = files.invoice?.[0];

    if (!nocFile || !ewayBillFile || !invoiceFile) {
      const missing = [];
      if (!nocFile) missing.push('NOC');
      if (!ewayBillFile) missing.push('E-Way Bill');
      if (!invoiceFile) missing.push('Invoice');
      return res.status(400).json({
        success: false,
        message: `Missing required documents: ${missing.join(', ')}. All three documents must be uploaded to execute the dispatch.`,
      });
    }

    const { vehicleNumber, driverName, driverContact, transportCompanyName, notes, siblingIds } = req.body;
    const sharedFields = {
      vehicleNumber: vehicleNumber || '',
      driverName: driverName || '',
      driverContact: driverContact || '',
      transportCompanyName: transportCompanyName || '',
      notes: notes || '',
      status: 'Dispatched',
      actualDispatchDate: new Date().toISOString().split('T')[0],
      'deliveryDocs.noc': nocFile.path.replace(/\\/g, '/'),
      'deliveryDocs.ewayBill': ewayBillFile.path.replace(/\\/g, '/'),
      'deliveryDocs.invoice': invoiceFile.path.replace(/\\/g, '/'),
    };

    const dispatch = await DispatchOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, status: 'Ready' },
      sharedFields,
      { new: true }
    );
    if (!dispatch) return res.status(404).json({ success: false, message: 'Dispatch order not found or not in Ready state' });

    // The rest of this order's machines (if any) share the SAME uploaded
    // documents — one NOC/E-Way Bill/Invoice set covers the whole truckload,
    // so those DispatchOrder records just get pointed at the file paths
    // already saved above instead of the browser re-uploading the same
    // files once per machine.
    let siblingCount = 0;
    let parsedSiblingIds = [];
    if (siblingIds) {
      try {
        parsedSiblingIds = JSON.parse(siblingIds);
      } catch (_) { parsedSiblingIds = []; }
    }
    if (Array.isArray(parsedSiblingIds) && parsedSiblingIds.length) {
      const result = await DispatchOrder.updateMany(
        { _id: { $in: parsedSiblingIds }, company: req.user.companyId, status: 'Ready' },
        { $set: sharedFields }
      );
      siblingCount = result.modifiedCount || 0;
    }

    // 🔔 Notify Sales & Accounts that order is dispatched
    try {
      await notificationService.triggerDispatchNotification({
        action: 'dispatched',
        data: {
          orderCode: dispatch.orderId,
          dispatchId: dispatch.dispatchId,
          customerName: dispatch.customerName,
          dispatchOrderId: dispatch._id,
          machineCount: siblingCount + 1,
        },
        targetCompanyId: dispatch.company,
      });
    } catch (e) { console.error('Dispatch notification error:', e); }

    res.json({ success: true, data: dispatch, siblingsUpdated: siblingCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const markInTransit = async (req, res) => {
  try {
    const dispatch = await DispatchOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, status: 'Dispatched' },
      { status: 'In Transit' },
      { new: true }
    );
    if (!dispatch) return res.status(404).json({ success: false, message: 'Dispatch order not found or not Dispatched' });
    res.json({ success: true, data: dispatch });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const confirmDelivery = async (req, res) => {
  try {
    // Delivery documents are validated/captured at executeDispatch time now. Confirming
    // delivery also absorbs the old separate "close" step — goes straight to 'Closed' so
    // it moves directly into Dispatch History instead of lingering in an interim 'Delivered'
    // state waiting for a manual close action.
    const { deliveryOTPVerified } = req.body;

    const dispatch = await DispatchOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, status: { $in: ['Dispatched', 'In Transit'] } },
      {
        status: 'Closed',
        actualDeliveryDate: new Date().toISOString().split('T')[0],
        deliveryOTPVerified: !!deliveryOTPVerified,
      },
      { new: true }
    );

    if (!dispatch) {
      return res.status(404).json({ success: false, message: 'Dispatch order not found or not in transit' });
    }

    // 🔔 Notify Sales Head and Accounts on delivery
    try {
      await notificationService.triggerDispatchNotification({
        action: 'delivery_confirmed',
        data: { orderCode: dispatch.orderId, customerName: dispatch.customerName, dispatchId: dispatch.dispatchId, dispatchOrderId: dispatch._id },
        targetCompanyId: dispatch.company,
      });
    } catch (e) { console.error('Delivery confirmed notification error:', e); }

    res.json({ success: true, data: dispatch });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const closeDispatch = async (req, res) => {
  try {
    const dispatch = await DispatchOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, status: 'Delivered' },
      { status: 'Closed' },
      { new: true }
    );
    if (!dispatch) return res.status(404).json({ success: false, message: 'Dispatch order not found or not yet Delivered' });
    res.json({ success: true, data: dispatch });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateDispatchOrder = async (req, res) => {
  try {
    const dispatch = await DispatchOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { ...req.body },
      { new: true }
    );
    if (!dispatch) return res.status(404).json({ success: false, message: 'Dispatch order not found' });
    res.json({ success: true, data: dispatch });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
