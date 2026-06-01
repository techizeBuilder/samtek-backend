"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateDispatchOrder = exports.closeDispatch = exports.confirmDelivery = exports.markInTransit = exports.executeDispatch = exports.createDispatchOrder = exports.getDispatchOrders = exports.completePacking = exports.updateChecklist = exports.startPacking = exports.updatePackingType = exports.createPackagingJob = exports.getPackagingJobs = exports.getReadyForPackaging = exports.getDashboard = void 0;
const PackagingJob_js_1 = __importDefault(require("../models/PackagingJob.js"));
const DispatchOrder_js_1 = __importDefault(require("../models/DispatchOrder.js"));
const ProductionOrder_js_1 = __importDefault(require("../models/ProductionOrder.js"));
const QCJob_js_1 = __importDefault(require("../models/QCJob.js"));
const now = () => new Date().toISOString();
// ── ID Generators ─────────────────────────────────────────────────────────────
function generateJobId(companyId) {
    return __awaiter(this, void 0, void 0, function* () {
        const year = new Date().getFullYear();
        const count = yield PackagingJob_js_1.default.countDocuments({ company: companyId });
        return `PKG-${year}-${String(count + 1).padStart(3, '0')}`;
    });
}
function generateSerialNumber(companyId) {
    return __awaiter(this, void 0, void 0, function* () {
        const year = new Date().getFullYear();
        const count = yield PackagingJob_js_1.default.countDocuments({ company: companyId });
        return `SN-${year}-${String(count + 1).padStart(4, '0')}`;
    });
}
function generateDispatchId(companyId) {
    return __awaiter(this, void 0, void 0, function* () {
        const year = new Date().getFullYear();
        const count = yield DispatchOrder_js_1.default.countDocuments({ company: companyId });
        return `DIS-${year}-${String(count + 1).padStart(3, '0')}`;
    });
}
function generateTrackingId() {
    return `TRK-${Date.now().toString(36).toUpperCase()}`;
}
// ── DASHBOARD ─────────────────────────────────────────────────────────────────
const getDashboard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const cid = req.user.companyId;
        // Get IDs already assigned to a packaging job
        const existingJobOrderIds = yield PackagingJob_js_1.default.distinct('productionOrderId', { company: cid, productionOrderId: { $ne: null } });
        const existingQCJobIds = yield PackagingJob_js_1.default.distinct('qcJobId', { company: cid, qcJobId: { $ne: null } });
        const [prodReadyCount, qcReadyCount, packagingPending, packagingInProgress, packagingPacked, dispatchReady, dispatchInTransit, dispatchDelivered, dispatchClosed,] = yield Promise.all([
            // Production orders QC-approved and not yet in a packaging job
            ProductionOrder_js_1.default.countDocuments({
                company: cid,
                status: 'Completed',
                'processes': { $elemMatch: { step: 'Final Testing', qcStatus: 'Approved' } },
                _id: { $nin: existingJobOrderIds },
            }),
            // QC jobs approved and not yet in a packaging job
            QCJob_js_1.default.countDocuments({
                company: cid,
                status: 'Approved',
                _id: { $nin: existingQCJobIds },
            }),
            PackagingJob_js_1.default.countDocuments({ company: cid, status: 'Pending' }),
            PackagingJob_js_1.default.countDocuments({ company: cid, status: 'In Progress' }),
            PackagingJob_js_1.default.countDocuments({ company: cid, status: 'Packed' }),
            DispatchOrder_js_1.default.countDocuments({ company: cid, status: 'Ready' }),
            DispatchOrder_js_1.default.countDocuments({ company: cid, status: { $in: ['Dispatched', 'In Transit'] } }),
            DispatchOrder_js_1.default.countDocuments({ company: cid, status: 'Delivered' }),
            DispatchOrder_js_1.default.countDocuments({ company: cid, status: 'Closed' }),
        ]);
        const readyForPackaging = prodReadyCount + qcReadyCount;
        // Recent dispatches (last 5)
        const recentDispatches = yield DispatchOrder_js_1.default.find({ company: cid })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();
        // Delayed deliveries: In Transit with expectedDeliveryDate < today
        const today = new Date().toISOString().split('T')[0];
        const delayedDeliveries = yield DispatchOrder_js_1.default.countDocuments({
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
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getDashboard = getDashboard;
// ── PACKAGING QUEUE ───────────────────────────────────────────────────────────
const getReadyForPackaging = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const cid = req.user.companyId;
        // Get IDs already assigned to a packaging job
        const existingJobOrderIds = yield PackagingJob_js_1.default.distinct('productionOrderId', { company: cid, productionOrderId: { $ne: null } });
        const existingQCJobIds = yield PackagingJob_js_1.default.distinct('qcJobId', { company: cid, qcJobId: { $ne: null } });
        const [orders, qcJobs] = yield Promise.all([
            ProductionOrder_js_1.default.find({
                company: cid,
                status: 'Completed',
                'processes': { $elemMatch: { step: 'Final Testing', qcStatus: 'Approved' } },
                _id: { $nin: existingJobOrderIds },
            })
                .sort({ createdAt: -1 })
                .populate('processes.assignedTeam', 'name supervisor')
                .lean(),
            QCJob_js_1.default.find({
                company: cid,
                status: 'Approved',
                _id: { $nin: existingQCJobIds }
            })
                .sort({ updatedAt: -1 })
                .lean()
        ]);
        // Map QCJobs to the format expected by the frontend packaging queue page
        const qcMapped = qcJobs.map(job => ({
            _id: job._id,
            isQCJob: true,
            orderId: job.itemCode || job.qcJobId || 'Store Order',
            machineCode: job.sourceRefId || 'N/A',
            machineName: job.itemName || 'Store Item',
            createdAt: job.createdAt,
            processes: [
                {
                    step: 'Final Testing',
                    qcStatus: 'Approved'
                }
            ]
        }));
        // Combine production orders and QC-approved store items
        const combined = [...orders, ...qcMapped];
        res.json({ success: true, data: combined });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getReadyForPackaging = getReadyForPackaging;
// ── PACKAGING JOBS ────────────────────────────────────────────────────────────
const getPackagingJobs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const jobs = yield PackagingJob_js_1.default.find({ company: req.user.companyId })
            .sort({ createdAt: -1 })
            .lean();
        const Sale = (yield Promise.resolve().then(() => __importStar(require('../models/Sale.js')))).default;
        const Order = (yield Promise.resolve().then(() => __importStar(require('../models/Order.js')))).default;
        const enrichedJobs = yield Promise.all(jobs.map((job) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            let nocStatus = 'Pending';
            let gatePassStatus = 'Pending';
            let customerName = '';
            let customerContact = '';
            let invoiceNumber = '';
            if (job.orderId) {
                // orderId is actually the orderCode string
                const order = yield Order.findOne({ orderCode: job.orderId, companyId: req.user.companyId }).populate('customer');
                if (order) {
                    customerName = ((_a = order.customer) === null || _a === void 0 ? void 0 : _a.name) || '';
                    customerContact = ((_b = order.customer) === null || _b === void 0 ? void 0 : _b.mobile) || '';
                    const sale = yield Sale.findOne({ order: order._id });
                    if (sale) {
                        nocStatus = ((_c = sale.gatePass) === null || _c === void 0 ? void 0 : _c.nocStatus) || 'Pending';
                        gatePassStatus = ((_d = sale.gatePass) === null || _d === void 0 ? void 0 : _d.status) || 'Pending';
                        invoiceNumber = sale.invoiceNumber || '';
                    }
                }
            }
            return Object.assign(Object.assign({}, job), { nocStatus,
                gatePassStatus,
                customerName,
                customerContact,
                invoiceNumber });
        })));
        res.json({ success: true, data: enrichedJobs });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getPackagingJobs = getPackagingJobs;
const createPackagingJob = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
            const isQC = yield QCJob_js_1.default.exists({ _id: productionOrderId });
            if (isQC) {
                actualQcJobId = productionOrderId;
                actualProdOrderId = undefined;
            }
        }
        if (actualProdOrderId) {
            const existing = yield PackagingJob_js_1.default.findOne({ productionOrderId: actualProdOrderId, company: req.user.companyId });
            if (existing)
                return res.status(400).json({ success: false, message: 'Packaging job already exists for this order' });
        }
        else if (actualQcJobId) {
            const existing = yield PackagingJob_js_1.default.findOne({ qcJobId: actualQcJobId, company: req.user.companyId });
            if (existing)
                return res.status(400).json({ success: false, message: 'Packaging job already exists for this QC Job' });
        }
        const jobId = yield generateJobId(req.user.companyId);
        const serialNumber = yield generateSerialNumber(req.user.companyId);
        const jobData = {
            jobId,
            orderId,
            machineCode,
            machineName,
            serialNumber,
            packingType: packingType || 'Wooden Packing',
            notes: notes || '',
            company: req.user.companyId,
            createdBy: req.user._id,
        };
        // Only set these fields if they have actual values — never set to null/undefined
        // to avoid triggering the unique partial index on productionOrderId
        if (actualProdOrderId)
            jobData.productionOrderId = actualProdOrderId;
        if (actualQcJobId)
            jobData.qcJobId = actualQcJobId;
        const job = yield PackagingJob_js_1.default.create(jobData);
        res.status(201).json({ success: true, data: job });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.createPackagingJob = createPackagingJob;
const updatePackingType = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { packingType, notes } = req.body;
        const job = yield PackagingJob_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId }, { packingType, notes }, { new: true });
        if (!job)
            return res.status(404).json({ success: false, message: 'Job not found' });
        res.json({ success: true, data: job });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.updatePackingType = updatePackingType;
const startPacking = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const job = yield PackagingJob_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId, status: 'Pending' }, { status: 'In Progress', packingStartTime: now() }, { new: true });
        if (!job)
            return res.status(404).json({ success: false, message: 'Job not found or not in Pending state' });
        res.json({ success: true, data: job });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.startPacking = startPacking;
const updateChecklist = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { allPartsIncluded, accessoriesIncluded, manualIncluded, invoiceCopyIncluded, safetyPackingCompleted } = req.body;
        const job = yield PackagingJob_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId }, {
            'checklist.allPartsIncluded': allPartsIncluded,
            'checklist.accessoriesIncluded': accessoriesIncluded,
            'checklist.manualIncluded': manualIncluded,
            'checklist.invoiceCopyIncluded': invoiceCopyIncluded,
            'checklist.safetyPackingCompleted': safetyPackingCompleted,
        }, { new: true });
        if (!job)
            return res.status(404).json({ success: false, message: 'Job not found' });
        res.json({ success: true, data: job });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.updateChecklist = updateChecklist;
const completePacking = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { photoProofUrl } = req.body;
        const job = yield PackagingJob_js_1.default.findOne({ _id: req.params.id, company: req.user.companyId });
        if (!job)
            return res.status(404).json({ success: false, message: 'Job not found' });
        const cl = job.checklist;
        const allDone = cl.allPartsIncluded && cl.accessoriesIncluded && cl.manualIncluded && cl.invoiceCopyIncluded && cl.safetyPackingCompleted;
        if (!allDone) {
            return res.status(400).json({ success: false, message: 'All checklist items must be completed before marking packing as complete' });
        }
        job.status = 'Packed';
        job.packingCompleteTime = now();
        if (photoProofUrl)
            job.photoProofUrl = photoProofUrl;
        yield job.save();
        res.json({ success: true, data: job });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.completePacking = completePacking;
// ── DISPATCH ORDERS ───────────────────────────────────────────────────────────
const getDispatchOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status } = req.query;
        const filter = { company: req.user.companyId };
        if (status)
            filter.status = status;
        const orders = yield DispatchOrder_js_1.default.find(filter).sort({ createdAt: -1 }).lean();
        res.json({ success: true, data: orders });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getDispatchOrders = getDispatchOrders;
const createDispatchOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { packagingJobId, orderId, machineCode, machineName, serialNumber, customerName, customerContact, deliveryAddress, transportType, plannedDispatchDate, expectedDeliveryDate, invoiceNumber, packingListNotes, notes, } = req.body;
        if (!packagingJobId || !orderId) {
            return res.status(400).json({ success: false, message: 'packagingJobId and orderId are required' });
        }
        // Verify packaging job is in Packed state
        const job = yield PackagingJob_js_1.default.findOne({ _id: packagingJobId, company: req.user.companyId, status: 'Packed' });
        if (!job)
            return res.status(400).json({ success: false, message: 'Packaging job not found or not yet Packed' });
        const dispatchId = yield generateDispatchId(req.user.companyId);
        const trackingId = generateTrackingId();
        const dispatch = yield DispatchOrder_js_1.default.create({
            dispatchId,
            packagingJobId,
            productionOrderId: job.productionOrderId || undefined,
            qcJobId: job.qcJobId || undefined,
            orderId,
            machineCode: machineCode || job.machineCode,
            machineName: machineName || job.machineName,
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
        yield PackagingJob_js_1.default.findByIdAndUpdate(packagingJobId, { status: 'Dispatched' });
        res.status(201).json({ success: true, data: dispatch });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.createDispatchOrder = createDispatchOrder;
const executeDispatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { vehicleNumber, driverName, driverContact, transportCompanyName, notes } = req.body;
        const dispatch = yield DispatchOrder_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId, status: 'Ready' }, {
            vehicleNumber: vehicleNumber || '',
            driverName: driverName || '',
            driverContact: driverContact || '',
            transportCompanyName: transportCompanyName || '',
            notes: notes || '',
            status: 'Dispatched',
            actualDispatchDate: new Date().toISOString().split('T')[0],
        }, { new: true });
        if (!dispatch)
            return res.status(404).json({ success: false, message: 'Dispatch order not found or not in Ready state' });
        res.json({ success: true, data: dispatch });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.executeDispatch = executeDispatch;
const markInTransit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const dispatch = yield DispatchOrder_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId, status: 'Dispatched' }, { status: 'In Transit' }, { new: true });
        if (!dispatch)
            return res.status(404).json({ success: false, message: 'Dispatch order not found or not Dispatched' });
        res.json({ success: true, data: dispatch });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.markInTransit = markInTransit;
const confirmDelivery = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { deliveryProofUrl, deliveryOTPVerified } = req.body;
        const dispatch = yield DispatchOrder_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId, status: { $in: ['Dispatched', 'In Transit'] } }, {
            status: 'Delivered',
            actualDeliveryDate: new Date().toISOString().split('T')[0],
            deliveryProofUrl: deliveryProofUrl || '',
            deliveryOTPVerified: !!deliveryOTPVerified,
        }, { new: true });
        if (!dispatch)
            return res.status(404).json({ success: false, message: 'Dispatch order not found or not in transit' });
        res.json({ success: true, data: dispatch });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.confirmDelivery = confirmDelivery;
const closeDispatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const dispatch = yield DispatchOrder_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId, status: 'Delivered' }, { status: 'Closed' }, { new: true });
        if (!dispatch)
            return res.status(404).json({ success: false, message: 'Dispatch order not found or not yet Delivered' });
        res.json({ success: true, data: dispatch });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.closeDispatch = closeDispatch;
const updateDispatchOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const dispatch = yield DispatchOrder_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId }, Object.assign({}, req.body), { new: true });
        if (!dispatch)
            return res.status(404).json({ success: false, message: 'Dispatch order not found' });
        res.json({ success: true, data: dispatch });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.updateDispatchOrder = updateDispatchOrder;
