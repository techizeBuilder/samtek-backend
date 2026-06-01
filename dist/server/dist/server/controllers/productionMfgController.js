"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function () { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function (o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function (o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o)
                if (Object.prototype.hasOwnProperty.call(o, k))
                    ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule)
            return mod;
        var result = {};
        if (mod != null)
            for (var k = ownKeys(mod), i = 0; i < k.length; i++)
                if (k[i] !== "default")
                    __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.createTeam = exports.getTeams = exports.updateProcessNotes = exports.rejectQC = exports.approveQC = exports.markProcessComplete = exports.startProcess = exports.assignTeam = exports.updateMaterialStatus = exports.addMaterialDemand = exports.markMaterialIssued = exports.raiseRDRequest = exports.verifyDesign = exports.verifyBOM = exports.createOrder = exports.getOrders = void 0;
const ProductionOrder_js_1 = __importStar(require("../models/ProductionOrder.js"));
const ProductionTeam_js_1 = __importDefault(require("../models/ProductionTeam.js"));
const today = () => new Date().toISOString().split('T')[0];
// ─── ORDER ID GENERATOR ───────────────────────────────────────────────────────
function generateOrderId(companyId) {
    return __awaiter(this, void 0, void 0, function* () {
        const year = new Date().getFullYear();
        const count = yield ProductionOrder_js_1.default.countDocuments({ company: companyId });
        return `ORD-${year}-${String(count + 1).padStart(3, '0')}`;
    });
}
// ─── ORDERS ───────────────────────────────────────────────────────────────────
const getOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const companyId = req.user.companyId;
        console.log(`🔍 Fetching Production Orders for Company: ${companyId}`);
        // Find orders for this company, using lean() for faster read and easier debugging
        const orders = yield ProductionOrder_js_1.default.find({
            company: companyId
        })
            .populate('processes.assignedTeam', 'name supervisor members')
            .sort({ createdAt: -1 })
            .lean();
        console.log(`✅ Found ${orders.length} orders for company ${companyId}`);
        res.json({ success: true, data: orders });
    }
    catch (err) {
        console.error('❌ Error in getOrders:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getOrders = getOrders;
const createOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { machineCode, machineName, priority, deliveryDate, source, rejectionDetails } = req.body;
        if (!machineCode || !machineName || !deliveryDate) {
            return res.status(400).json({ success: false, message: 'machineCode, machineName and deliveryDate are required' });
        }
        // Generate appropriate order ID based on source
        let orderId;
        if (source === 'QC_Rejected') {
            const year = new Date().getFullYear();
            const lastRejectedOrder = yield ProductionOrder_js_1.default.findOne({
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
        }
        else {
            orderId = yield generateOrderId(req.user.companyId);
        }
        const order = yield ProductionOrder_js_1.default.create({
            orderId,
            machineCode,
            machineName,
            priority: priority || (source === 'QC_Rejected' ? 'Urgent' : 'Normal'),
            source: source || 'Store',
            rejectionDetails: rejectionDetails || {},
            receivedDate: today(),
            deliveryDate,
            company: req.user.companyId,
            createdBy: req.user._id,
        });
        res.status(201).json({ success: true, data: order });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.createOrder = createOrder;
const verifyBOM = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const order = yield ProductionOrder_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId }, { bomVerified: true }, { new: true });
        if (!order)
            return res.status(404).json({ success: false, message: 'Order not found' });
        res.json({ success: true, data: order });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.verifyBOM = verifyBOM;
const verifyDesign = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const order = yield ProductionOrder_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId }, { designVerified: true }, { new: true });
        if (!order)
            return res.status(404).json({ success: false, message: 'Order not found' });
        res.json({ success: true, data: order });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.verifyDesign = verifyDesign;
const raiseRDRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const order = yield ProductionOrder_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId }, { rdRequestRaised: true, status: 'BOM Pending' }, { new: true });
        if (!order)
            return res.status(404).json({ success: false, message: 'Order not found' });
        res.json({ success: true, data: order });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.raiseRDRequest = raiseRDRequest;
const markMaterialIssued = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const order = yield ProductionOrder_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId }, { materialIssued: true, 'materialDemands.$[].status': 'Issued' }, { new: true });
        if (!order)
            return res.status(404).json({ success: false, message: 'Order not found' });
        res.json({ success: true, data: order });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.markMaterialIssued = markMaterialIssued;
// ─── MATERIAL DEMANDS ─────────────────────────────────────────────────────────
const addMaterialDemand = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { materialCode, materialName, quantity, unit } = req.body;
        if (!materialCode || !materialName || !quantity || !unit) {
            return res.status(400).json({ success: false, message: 'All material fields are required' });
        }
        const order = yield ProductionOrder_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId }, { $push: { materialDemands: { materialCode, materialName, quantity: Number(quantity), unit, status: 'Requested' } } }, { new: true });
        if (!order)
            return res.status(404).json({ success: false, message: 'Order not found' });
        res.json({ success: true, data: order });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.addMaterialDemand = addMaterialDemand;
const updateMaterialStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status } = req.body;
        const order = yield ProductionOrder_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId, 'materialDemands._id': req.params.materialId }, { $set: { 'materialDemands.$.status': status } }, { new: true });
        if (!order)
            return res.status(404).json({ success: false, message: 'Order or material not found' });
        res.json({ success: true, data: order });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.updateMaterialStatus = updateMaterialStatus;
// ─── PROCESS OPERATIONS ───────────────────────────────────────────────────────
// stepIndex: 0–5 mapping to PROCESS_STEPS array
function getStepIndex(req, res) {
    const idx = parseInt(req.params.stepIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= ProductionOrder_js_1.PROCESS_STEPS.length) {
        res.status(400).json({ success: false, message: 'Invalid step index (0–5)' });
        return -1;
    }
    return idx;
}
const assignTeam = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const idx = getStepIndex(req, res);
        if (idx === -1)
            return;
        const { teamId } = req.body;
        const order = yield ProductionOrder_js_1.default.findOne({ _id: req.params.id, company: req.user.companyId });
        if (!order)
            return res.status(404).json({ success: false, message: 'Order not found' });
        order.processes[idx].assignedTeam = teamId || null;
        yield order.save();
        yield order.populate('processes.assignedTeam', 'name supervisor members');
        res.json({ success: true, data: order });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.assignTeam = assignTeam;
const startProcess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const idx = getStepIndex(req, res);
        if (idx === -1)
            return;
        const order = yield ProductionOrder_js_1.default.findOne({ _id: req.params.id, company: req.user.companyId });
        if (!order)
            return res.status(404).json({ success: false, message: 'Order not found' });
        // Gate: previous step must be completed
        if (idx > 0 && order.processes[idx - 1].status !== 'Completed') {
            return res.status(400).json({ success: false, message: `Cannot start ${ProductionOrder_js_1.PROCESS_STEPS[idx]}: ${ProductionOrder_js_1.PROCESS_STEPS[idx - 1]} not yet completed` });
        }
        order.processes[idx].status = 'In Progress';
        order.processes[idx].startDate = today();
        order.status = 'In Progress';
        yield order.save();
        yield order.populate('processes.assignedTeam', 'name supervisor members');
        res.json({ success: true, data: order });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.startProcess = startProcess;
const markProcessComplete = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const idx = getStepIndex(req, res);
        if (idx === -1)
            return;
        const order = yield ProductionOrder_js_1.default.findOne({ _id: req.params.id, company: req.user.companyId });
        if (!order)
            return res.status(404).json({ success: false, message: 'Order not found' });
        order.processes[idx].status = 'QC Pending';
        order.processes[idx].endDate = today();
        yield order.save();
        yield order.populate('processes.assignedTeam', 'name supervisor members');
        res.json({ success: true, data: order });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.markProcessComplete = markProcessComplete;
const approveQC = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const idx = getStepIndex(req, res);
        if (idx === -1)
            return;
        const { qcBy } = req.body;
        if (!qcBy)
            return res.status(400).json({ success: false, message: 'qcBy is required' });
        const order = yield ProductionOrder_js_1.default.findOne({ _id: req.params.id, company: req.user.companyId });
        if (!order)
            return res.status(404).json({ success: false, message: 'Order not found' });
        order.processes[idx].status = 'Completed';
        order.processes[idx].qcStatus = 'Approved';
        order.processes[idx].qcBy = qcBy;
        order.processes[idx].qcDate = today();
        // Check if all processes completed
        if (order.processes.every(p => p.status === 'Completed')) {
            order.status = 'Completed';
        }
        yield order.save();
        yield order.populate('processes.assignedTeam', 'name supervisor members');
        res.json({ success: true, data: order });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.approveQC = approveQC;
const rejectQC = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const idx = getStepIndex(req, res);
        if (idx === -1)
            return;
        const { qcBy, reason } = req.body;
        if (!qcBy)
            return res.status(400).json({ success: false, message: 'qcBy is required' });
        const order = yield ProductionOrder_js_1.default.findOne({ _id: req.params.id, company: req.user.companyId });
        if (!order)
            return res.status(404).json({ success: false, message: 'Order not found' });
        const proc = order.processes[idx];
        proc.status = 'In Progress';
        proc.qcStatus = 'Rejected';
        proc.qcBy = qcBy;
        proc.qcDate = today();
        proc.notes = reason || proc.notes;
        proc.reworks.push({ date: today(), reason: reason || '', rejectedBy: qcBy });
        yield order.save();
        yield order.populate('processes.assignedTeam', 'name supervisor members');
        res.json({ success: true, data: order });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.rejectQC = rejectQC;
const updateProcessNotes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const idx = getStepIndex(req, res);
        if (idx === -1)
            return;
        const { notes } = req.body;
        const order = yield ProductionOrder_js_1.default.findOne({ _id: req.params.id, company: req.user.companyId });
        if (!order)
            return res.status(404).json({ success: false, message: 'Order not found' });
        order.processes[idx].notes = notes || '';
        yield order.save();
        res.json({ success: true, data: order });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.updateProcessNotes = updateProcessNotes;
// ─── TEAMS ────────────────────────────────────────────────────────────────────
const getTeams = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const teams = yield ProductionTeam_js_1.default.find({ company: req.user.companyId, isActive: true }).sort({ createdAt: 1 });
        res.json({ success: true, data: teams });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getTeams = getTeams;
const createTeam = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, supervisor, members, skills, efficiency } = req.body;
        if (!name || !supervisor) {
            return res.status(400).json({ success: false, message: 'name and supervisor are required' });
        }
        const team = yield ProductionTeam_js_1.default.create({
            name,
            supervisor,
            members: members || [],
            skills: skills || [],
            efficiency: efficiency || 85,
            company: req.user.companyId,
            createdBy: req.user._id,
        });
        res.status(201).json({ success: true, data: team });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.createTeam = createTeam;
