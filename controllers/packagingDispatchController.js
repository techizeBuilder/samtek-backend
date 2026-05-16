import PackagingJob from '../models/PackagingJob.js';
import DispatchOrder from '../models/DispatchOrder.js';
import ProductionOrder from '../models/ProductionOrder.js';

const now = () => new Date().toISOString();

// ── ID Generators ─────────────────────────────────────────────────────────────

async function generateJobId(companyId) {
  const year = new Date().getFullYear();
  const count = await PackagingJob.countDocuments({ company: companyId });
  return `PKG-${year}-${String(count + 1).padStart(3, '0')}`;
}

async function generateSerialNumber(companyId) {
  const year = new Date().getFullYear();
  const count = await PackagingJob.countDocuments({ company: companyId });
  return `SN-${year}-${String(count + 1).padStart(4, '0')}`;
}

async function generateDispatchId(companyId) {
  const year = new Date().getFullYear();
  const count = await DispatchOrder.countDocuments({ company: companyId });
  return `DIS-${year}-${String(count + 1).padStart(3, '0')}`;
}

function generateTrackingId() {
  return `TRK-${Date.now().toString(36).toUpperCase()}`;
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────

export const getDashboard = async (req, res) => {
  try {
    const cid = req.user.companyId;

    const [
      readyForPackaging,
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
        _id: { $nin: await PackagingJob.distinct('productionOrderId', { company: cid }) },
      }),
      PackagingJob.countDocuments({ company: cid, status: 'Pending' }),
      PackagingJob.countDocuments({ company: cid, status: 'In Progress' }),
      PackagingJob.countDocuments({ company: cid, status: 'Packed' }),
      DispatchOrder.countDocuments({ company: cid, status: 'Ready' }),
      DispatchOrder.countDocuments({ company: cid, status: { $in: ['Dispatched', 'In Transit'] } }),
      DispatchOrder.countDocuments({ company: cid, status: 'Delivered' }),
      DispatchOrder.countDocuments({ company: cid, status: 'Closed' }),
    ]);

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
    const existingJobOrderIds = await PackagingJob.distinct('productionOrderId', { company: cid });

    const orders = await ProductionOrder.find({
      company: cid,
      status: 'Completed',
      'processes': { $elemMatch: { step: 'Final Testing', qcStatus: 'Approved' } },
      _id: { $nin: existingJobOrderIds },
    })
      .sort({ createdAt: -1 })
      .populate('processes.assignedTeam', 'name supervisor')
      .lean();

    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PACKAGING JOBS ────────────────────────────────────────────────────────────

export const getPackagingJobs = async (req, res) => {
  try {
    const jobs = await PackagingJob.find({ company: req.user.companyId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: jobs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createPackagingJob = async (req, res) => {
  try {
    const { productionOrderId, orderId, machineCode, machineName, packingType, notes } = req.body;
    if (!productionOrderId || !orderId || !machineCode || !machineName) {
      return res.status(400).json({ success: false, message: 'productionOrderId, orderId, machineCode, machineName are required' });
    }

    const existing = await PackagingJob.findOne({ productionOrderId, company: req.user.companyId });
    if (existing) return res.status(400).json({ success: false, message: 'Packaging job already exists for this order' });

    const jobId = await generateJobId(req.user.companyId);
    const serialNumber = await generateSerialNumber(req.user.companyId);

    const job = await PackagingJob.create({
      jobId,
      productionOrderId,
      orderId,
      machineCode,
      machineName,
      serialNumber,
      packingType: packingType || 'Wooden Packing',
      notes: notes || '',
      company: req.user.companyId,
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: job });
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
    const { allPartsIncluded, accessoriesIncluded, manualIncluded, invoiceCopyIncluded, safetyPackingCompleted } = req.body;
    const job = await PackagingJob.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      {
        'checklist.allPartsIncluded': allPartsIncluded,
        'checklist.accessoriesIncluded': accessoriesIncluded,
        'checklist.manualIncluded': manualIncluded,
        'checklist.invoiceCopyIncluded': invoiceCopyIncluded,
        'checklist.safetyPackingCompleted': safetyPackingCompleted,
      },
      { new: true }
    );
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
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

    const cl = job.checklist;
    const allDone = cl.allPartsIncluded && cl.accessoriesIncluded && cl.manualIncluded && cl.invoiceCopyIncluded && cl.safetyPackingCompleted;
    if (!allDone) {
      return res.status(400).json({ success: false, message: 'All checklist items must be completed before marking packing as complete' });
    }

    job.status = 'Packed';
    job.packingCompleteTime = now();
    if (photoProofUrl) job.photoProofUrl = photoProofUrl;
    await job.save();
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DISPATCH ORDERS ───────────────────────────────────────────────────────────

export const getDispatchOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { company: req.user.companyId };
    if (status) filter.status = status;
    const orders = await DispatchOrder.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createDispatchOrder = async (req, res) => {
  try {
    const {
      packagingJobId, productionOrderId, orderId, machineCode, machineName, serialNumber,
      customerName, customerContact, deliveryAddress,
      transportType, plannedDispatchDate, expectedDeliveryDate,
      invoiceNumber, packingListNotes, notes,
    } = req.body;

    if (!packagingJobId || !productionOrderId || !orderId) {
      return res.status(400).json({ success: false, message: 'packagingJobId, productionOrderId, orderId are required' });
    }

    // Verify packaging job is in Packed state
    const job = await PackagingJob.findOne({ _id: packagingJobId, company: req.user.companyId, status: 'Packed' });
    if (!job) return res.status(400).json({ success: false, message: 'Packaging job not found or not yet Packed' });

    const dispatchId = await generateDispatchId(req.user.companyId);
    const trackingId = generateTrackingId();

    const dispatch = await DispatchOrder.create({
      dispatchId,
      packagingJobId,
      productionOrderId,
      orderId,
      machineCode,
      machineName,
      serialNumber: serialNumber || job.serialNumber,
      customerName: customerName || '',
      customerContact: customerContact || '',
      deliveryAddress: deliveryAddress || '',
      transportType: transportType || 'Transport Company',
      plannedDispatchDate: plannedDispatchDate || null,
      expectedDeliveryDate: expectedDeliveryDate || null,
      trackingId,
      invoiceNumber: invoiceNumber || '',
      packingListNotes: packingListNotes || '',
      notes: notes || '',
      company: req.user.companyId,
      createdBy: req.user._id,
    });

    // Mark packaging job as Dispatched
    await PackagingJob.findByIdAndUpdate(packagingJobId, { status: 'Dispatched' });

    res.status(201).json({ success: true, data: dispatch });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const executeDispatch = async (req, res) => {
  try {
    const { vehicleNumber, driverName, driverContact, transportCompanyName, notes } = req.body;
    const dispatch = await DispatchOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, status: 'Ready' },
      {
        vehicleNumber: vehicleNumber || '',
        driverName: driverName || '',
        driverContact: driverContact || '',
        transportCompanyName: transportCompanyName || '',
        notes: notes || '',
        status: 'Dispatched',
        actualDispatchDate: new Date().toISOString().split('T')[0],
      },
      { new: true }
    );
    if (!dispatch) return res.status(404).json({ success: false, message: 'Dispatch order not found or not in Ready state' });
    res.json({ success: true, data: dispatch });
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
    const { deliveryProofUrl, deliveryOTPVerified } = req.body;
    const dispatch = await DispatchOrder.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, status: { $in: ['Dispatched', 'In Transit'] } },
      {
        status: 'Delivered',
        actualDeliveryDate: new Date().toISOString().split('T')[0],
        deliveryProofUrl: deliveryProofUrl || '',
        deliveryOTPVerified: !!deliveryOTPVerified,
      },
      { new: true }
    );
    if (!dispatch) return res.status(404).json({ success: false, message: 'Dispatch order not found or not in transit' });
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
