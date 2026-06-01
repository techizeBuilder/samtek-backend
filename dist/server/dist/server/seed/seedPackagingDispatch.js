"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedPackagingDispatch = void 0;
const User_js_1 = __importDefault(require("../models/User.js"));
const ProductionOrder_js_1 = __importDefault(require("../models/ProductionOrder.js"));
const ProductionTeam_js_1 = __importDefault(require("../models/ProductionTeam.js"));
const PackagingJob_js_1 = __importDefault(require("../models/PackagingJob.js"));
const DispatchOrder_js_1 = __importDefault(require("../models/DispatchOrder.js"));
const today = () => new Date().toISOString().split('T')[0];
const daysFrom = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; };
const daysAgo = (n) => daysFrom(-n);
const nowIso = () => new Date().toISOString();
const tryOp = (label, fn) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield fn();
        console.log(`  ✓ ${label}`);
        return { ok: true, label, result };
    }
    catch (err) {
        console.error(`  ✗ ${label}: ${err.message}`);
        return { ok: false, label, error: err.message };
    }
});
const seedPackagingDispatch = () => __awaiter(void 0, void 0, void 0, function* () {
    const user = yield User_js_1.default.findOne({ companyId: { $exists: true, $ne: null } }).lean();
    if (!user)
        return { success: false, message: 'No user with companyId found.' };
    const companyId = user.companyId;
    const userId = user._id;
    const results = [];
    // ── Clear existing packaging & dispatch data ─────────────────────────────
    yield PackagingJob_js_1.default.deleteMany({ company: companyId }).catch(() => { });
    yield DispatchOrder_js_1.default.deleteMany({ company: companyId }).catch(() => { });
    // ── Also remove extra test production orders we create here ──────────────
    yield ProductionOrder_js_1.default.deleteMany({
        company: companyId,
        orderId: { $in: ['ORD-2026-006', 'ORD-2026-007', 'ORD-2026-008', 'ORD-2026-009', 'ORD-2026-010'] },
    }).catch(() => { });
    // Get QC team (for assignedTeam refs)
    const qcTeam = yield ProductionTeam_js_1.default.findOne({ company: companyId, name: /QC/i }).lean();
    // ── Inject 5 more Completed production orders (Final Testing Approved) ────
    // These will show in the Packaging Queue
    let newOrders = [];
    const rOrders = yield tryOp('Extra completed production orders (5)', () => ProductionOrder_js_1.default.insertMany([
        {
            orderId: 'ORD-2026-006',
            machineCode: 'SAM-002', machineName: 'Pneumatic Conveyor System',
            priority: 'Urgent', status: 'Completed',
            receivedDate: daysAgo(25), deliveryDate: daysAgo(3),
            bomVerified: true, designVerified: true, rdRequestRaised: false, materialIssued: true,
            processes: completedProcesses(qcTeam, daysAgo(25), daysAgo(3)),
            materialDemands: [],
            company: companyId, createdBy: userId,
        },
        {
            orderId: 'ORD-2026-007',
            machineCode: 'SAM-004', machineName: 'Industrial Ribbon Blender',
            priority: 'Normal', status: 'Completed',
            receivedDate: daysAgo(20), deliveryDate: daysAgo(1),
            bomVerified: true, designVerified: true, rdRequestRaised: false, materialIssued: true,
            processes: completedProcesses(qcTeam, daysAgo(20), daysAgo(1)),
            materialDemands: [],
            company: companyId, createdBy: userId,
        },
        {
            orderId: 'ORD-2026-008',
            machineCode: 'SAM-001', machineName: 'High Speed Packaging Machine',
            priority: 'Normal', status: 'Completed',
            receivedDate: daysAgo(18), deliveryDate: daysAgo(2),
            bomVerified: true, designVerified: true, rdRequestRaised: false, materialIssued: true,
            processes: completedProcesses(qcTeam, daysAgo(18), daysAgo(2)),
            materialDemands: [],
            company: companyId, createdBy: userId,
        },
        {
            orderId: 'ORD-2026-009',
            machineCode: 'SAM-003', machineName: 'Rotary Sealer Unit',
            priority: 'Normal', status: 'Completed',
            receivedDate: daysAgo(12), deliveryDate: today(),
            bomVerified: true, designVerified: true, rdRequestRaised: false, materialIssued: true,
            processes: completedProcesses(qcTeam, daysAgo(12), today()),
            materialDemands: [],
            company: companyId, createdBy: userId,
        },
        {
            orderId: 'ORD-2026-010',
            machineCode: 'SAM-005', machineName: 'Automatic Labelling Machine',
            priority: 'Urgent', status: 'Completed',
            receivedDate: daysAgo(10), deliveryDate: daysFrom(2),
            bomVerified: true, designVerified: true, rdRequestRaised: false, materialIssued: true,
            processes: completedProcesses(qcTeam, daysAgo(10), daysFrom(2)),
            materialDemands: [],
            company: companyId, createdBy: userId,
        },
    ]));
    results.push(rOrders);
    if (rOrders.ok)
        newOrders = rOrders.result;
    // Also grab the existing ORD-2026-001 (already Completed + QC Approved from seedRDProduction)
    const ord001 = yield ProductionOrder_js_1.default.findOne({ company: companyId, orderId: 'ORD-2026-001' }).lean();
    const [ord006, ord007, ord008, ord009, ord010] = newOrders;
    // ── Packaging Jobs ────────────────────────────────────────────────────────
    // ORD-2026-009 and ORD-2026-010 are intentionally left WITHOUT a job → show in Packaging Queue
    // Job 1: Pending (ORD-2026-008 → High Speed PKG)
    // Job 2: In Progress with partial checklist (ORD-2026-007 → Ribbon Blender)
    // Job 3: Packed (ORD-2026-006 → Pneumatic Conveyor) — ready for dispatch
    // Job 4: Dispatched (will have dispatch order)
    let jobs = [];
    const jobDefs = [];
    if (ord008) {
        jobDefs.push({
            jobId: 'PKG-2026-001', productionOrderId: ord008._id,
            orderId: ord008.orderId, machineCode: ord008.machineCode, machineName: ord008.machineName,
            serialNumber: 'SN-2026-0001', packingType: 'Wooden Packing',
            status: 'Pending',
            checklist: { allPartsIncluded: false, accessoriesIncluded: false, manualIncluded: false, invoiceCopyIncluded: false, safetyPackingCompleted: false },
            notes: 'Awaiting packing team assignment',
            company: companyId, createdBy: userId,
        });
    }
    if (ord007) {
        jobDefs.push({
            jobId: 'PKG-2026-002', productionOrderId: ord007._id,
            orderId: ord007.orderId, machineCode: ord007.machineCode, machineName: ord007.machineName,
            serialNumber: 'SN-2026-0002', packingType: 'Bubble Wrap',
            status: 'In Progress',
            packingStartTime: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
            checklist: { allPartsIncluded: true, accessoriesIncluded: true, manualIncluded: true, invoiceCopyIncluded: false, safetyPackingCompleted: false },
            notes: 'Invoice copy pending from accounts',
            company: companyId, createdBy: userId,
        });
    }
    if (ord006) {
        jobDefs.push({
            jobId: 'PKG-2026-003', productionOrderId: ord006._id,
            orderId: ord006.orderId, machineCode: ord006.machineCode, machineName: ord006.machineName,
            serialNumber: 'SN-2026-0003', packingType: 'Wooden Packing',
            status: 'Packed',
            packingStartTime: new Date(Date.now() - 28 * 3600 * 1000).toISOString(),
            packingCompleteTime: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
            checklist: { allPartsIncluded: true, accessoriesIncluded: true, manualIncluded: true, invoiceCopyIncluded: true, safetyPackingCompleted: true },
            photoProofUrl: 'https://example.com/photos/PKG-2026-003.jpg',
            notes: 'Heavy unit — requires crane loading',
            company: companyId, createdBy: userId,
        });
    }
    // Also use ord001 (existing from R&D seed) if it belongs to this company
    if (ord001) {
        jobDefs.push({
            jobId: 'PKG-2026-004', productionOrderId: ord001._id,
            orderId: ord001.orderId, machineCode: ord001.machineCode, machineName: ord001.machineName,
            serialNumber: 'SN-2026-0004', packingType: 'Wooden Packing',
            status: 'Dispatched',
            packingStartTime: new Date(Date.now() - 96 * 3600 * 1000).toISOString(),
            packingCompleteTime: new Date(Date.now() - 90 * 3600 * 1000).toISOString(),
            checklist: { allPartsIncluded: true, accessoriesIncluded: true, manualIncluded: true, invoiceCopyIncluded: true, safetyPackingCompleted: true },
            photoProofUrl: 'https://example.com/photos/PKG-2026-004.jpg',
            notes: '',
            company: companyId, createdBy: userId,
        });
    }
    const rJobs = yield tryOp(`Packaging Jobs (${jobDefs.length})`, () => PackagingJob_js_1.default.insertMany(jobDefs));
    results.push(rJobs);
    if (rJobs.ok)
        jobs = rJobs.result;
    // Find jobs by jobId
    const jobMap = {};
    for (const j of jobs)
        jobMap[j.jobId] = j;
    const j5 = jobMap['PKG-2026-005'];
    const j6 = jobMap['PKG-2026-006'];
    // ── Dispatch Orders ───────────────────────────────────────────────────────
    // DIS-001: In Transit (for PKG-005 / Ribbon Blender) — slightly overdue
    // DIS-002: Delivered (for PKG-006 / High Speed PKG) — closed today
    // DIS-003: Ready (no vehicle assigned yet) — for PKG-003 that's Packed — we'll manually set it
    // We need to create dispatch orders for the dispatched jobs
    const dispatchDefs = [];
    if (j5 && ord007) {
        dispatchDefs.push({
            dispatchId: 'DIS-2026-001',
            packagingJobId: j5._id, productionOrderId: ord007._id,
            orderId: ord007.orderId, machineCode: ord007.machineCode, machineName: ord007.machineName,
            serialNumber: 'SN-2026-0005',
            customerName: 'Ravi Foods Pvt Ltd',
            customerContact: '9876543210',
            deliveryAddress: 'Plot 45, MIDC Industrial Area, Pune - 411018',
            transportType: 'Transport Company',
            vehicleNumber: 'MH12AB5678',
            driverName: 'Rajesh Kumar',
            driverContact: '9988776655',
            transportCompanyName: 'Sai Logistics',
            plannedDispatchDate: daysAgo(4),
            actualDispatchDate: daysAgo(4),
            expectedDeliveryDate: daysAgo(1), // overdue → delayed delivery
            trackingId: `TRK-${(Date.now() - 86400000).toString(36).toUpperCase()}`,
            status: 'In Transit',
            invoiceNumber: 'INV-2026-089',
            packingListNotes: 'Ribbon Blender 1000L, complete with motor, gearbox and accessories',
            notes: 'Customer notified via email. Transit delay due to highway closure.',
            company: companyId, createdBy: userId,
        });
    }
    if (j6 && ord001) {
        dispatchDefs.push({
            dispatchId: 'DIS-2026-002',
            packagingJobId: j6._id, productionOrderId: ord001._id,
            orderId: ord001.orderId, machineCode: ord001.machineCode, machineName: ord001.machineName,
            serialNumber: 'SN-2026-0006',
            customerName: 'Kolkata Snacks Ltd',
            customerContact: '9123456789',
            deliveryAddress: '12 Industrial Park, Sector 5, Kolkata - 700091',
            transportType: 'Transport Company',
            vehicleNumber: 'WB23CD9012',
            driverName: 'Suresh Pal',
            driverContact: '9876001234',
            transportCompanyName: 'Bengal Carriers',
            plannedDispatchDate: daysAgo(7),
            actualDispatchDate: daysAgo(7),
            expectedDeliveryDate: daysAgo(2),
            actualDeliveryDate: daysAgo(2),
            trackingId: `TRK-${(Date.now() - 200000000).toString(36).toUpperCase()}`,
            status: 'Delivered',
            deliveryProofUrl: 'https://example.com/delivery-proof/DIS-2026-002.jpg',
            deliveryOTPVerified: true,
            invoiceNumber: 'INV-2026-075',
            packingListNotes: 'High Speed Packaging Machine — 100 pouches/min, complete setup',
            notes: 'Delivered successfully. Customer satisfied. Commissioning scheduled for next week.',
            company: companyId, createdBy: userId,
        });
    }
    const rDispatch = yield tryOp(`Dispatch Orders (${dispatchDefs.length})`, () => DispatchOrder_js_1.default.insertMany(dispatchDefs));
    results.push(rDispatch);
    // ── Summary ───────────────────────────────────────────────────────────────
    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    return {
        success: failed === 0,
        message: `Packaging & Dispatch seed complete: ${passed} passed, ${failed} failed`,
        summary: {
            newProductionOrders: newOrders.length,
            packagingJobs: jobs.length,
            dispatchOrders: rDispatch.ok ? rDispatch.result.length : 0,
        },
        details: results.map(r => ({ label: r.label, ok: r.ok, error: r.error })),
    };
});
exports.seedPackagingDispatch = seedPackagingDispatch;
function completedProcesses(qcTeam, startDate, endDate) {
    return [
        { step: 'Job Work', type: 'Outsourcing', status: 'Completed', assignedTeam: null, startDate, endDate: daysAgo(Math.floor(Math.random() * 3) + 15), qcStatus: 'Approved', qcBy: 'Deepak M', qcDate: daysAgo(15), notes: '', reworks: [] },
        { step: 'Fabrication', type: 'In-House', status: 'Completed', assignedTeam: null, startDate: daysAgo(14), endDate: daysAgo(10), qcStatus: 'Approved', qcBy: 'Nalini R', qcDate: daysAgo(10), notes: '', reworks: [] },
        { step: 'Assembly', type: 'In-House', status: 'Completed', assignedTeam: null, startDate: daysAgo(9), endDate: daysAgo(7), qcStatus: 'Approved', qcBy: 'Nalini R', qcDate: daysAgo(7), notes: '', reworks: [] },
        { step: 'Painting', type: 'In-House', status: 'Completed', assignedTeam: null, startDate: daysAgo(6), endDate: daysAgo(5), qcStatus: 'Approved', qcBy: 'Deepak M', qcDate: daysAgo(5), notes: 'RAL 7035 powder coat', reworks: [] },
        { step: 'Re-Assembly', type: 'In-House', status: 'Completed', assignedTeam: null, startDate: daysAgo(4), endDate: daysAgo(3), qcStatus: 'Approved', qcBy: 'Nalini R', qcDate: daysAgo(3), notes: '', reworks: [] },
        { step: 'Final Testing', type: 'In-House', status: 'Completed', assignedTeam: (qcTeam === null || qcTeam === void 0 ? void 0 : qcTeam._id) || null, startDate: daysAgo(2), endDate: daysAgo(1), qcStatus: 'Approved', qcBy: 'Nalini R', qcDate: daysAgo(1), notes: 'All parameters within specification. Machine approved for dispatch.', reworks: [] },
    ];
}
