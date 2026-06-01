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
exports.deleteDocument = exports.createDocument = exports.getDocuments = exports.deleteQCItem = exports.addQCItem = exports.deleteQualityParam = exports.addQualityParam = exports.getQualityParams = exports.removeProcess = exports.addProcess = exports.reactivateTool = exports.discontinueTool = exports.removeTool = exports.addTool = exports.getToolProcesses = exports.resolveChangeRequest = exports.createChangeRequest = exports.getChangeRequests = exports.updatePrototype = exports.createPrototype = exports.getPrototypes = exports.reactivateMaterial = exports.discontinueMaterial = exports.lockBOM = exports.deleteMaterial = exports.updateMaterial = exports.addMaterial = exports.createBOM = exports.getBOMForMachine = exports.getBOMs = exports.reactivateMachine = exports.discontinueMachine = exports.updateReleaseStatus = exports.updateDesignStatus = exports.updateMachine = exports.createMachine = exports.getMachines = void 0;
const RDMachine_js_1 = __importDefault(require("../models/RDMachine.js"));
const RDBOM_js_1 = __importDefault(require("../models/RDBOM.js"));
const RDPrototype_js_1 = __importDefault(require("../models/RDPrototype.js"));
const RDChangeRequest_js_1 = __importDefault(require("../models/RDChangeRequest.js"));
const RDToolProcess_js_1 = __importDefault(require("../models/RDToolProcess.js"));
const RDQualityParam_js_1 = __importDefault(require("../models/RDQualityParam.js"));
const RDDocument_js_1 = __importDefault(require("../models/RDDocument.js"));
const fs_1 = __importDefault(require("fs"));
const today = () => new Date().toISOString().split('T')[0];
function generateChangeId(companyId) {
    return __awaiter(this, void 0, void 0, function* () {
        const year = new Date().getFullYear();
        const count = yield RDChangeRequest_js_1.default.countDocuments({ company: companyId });
        return `CR-${year}-${String(count + 1).padStart(3, '0')}`;
    });
}
// ─── MACHINES ─────────────────────────────────────────────────────────────────
const getMachines = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const machines = yield RDMachine_js_1.default.find({ company: req.user.companyId }).sort({ createdAt: -1 });
        res.json({ success: true, data: machines });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getMachines = getMachines;
const createMachine = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { code, name, category, description, machineType } = req.body;
        if (!code || !name || !category) {
            return res.status(400).json({ success: false, message: 'code, name and category are required' });
        }
        const machine = yield RDMachine_js_1.default.create({
            code, name, category, description: description || '',
            machineType: machineType || 'Standard',
            company: req.user.companyId,
            createdBy: req.user._id,
        });
        res.status(201).json({ success: true, data: machine });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.createMachine = createMachine;
const updateMachine = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const machine = yield RDMachine_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId }, Object.assign({}, req.body), { new: true });
        if (!machine)
            return res.status(404).json({ success: false, message: 'Machine not found' });
        res.json({ success: true, data: machine });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.updateMachine = updateMachine;
const updateDesignStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, note } = req.body;
        const update = { designStatus: status };
        if (status === 'Rejected')
            update.rejectionNote = note || '';
        const machine = yield RDMachine_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId }, update, { new: true });
        if (!machine)
            return res.status(404).json({ success: false, message: 'Machine not found' });
        res.json({ success: true, data: machine });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.updateDesignStatus = updateDesignStatus;
const updateReleaseStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status } = req.body;
        const machine = yield RDMachine_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId }, { releaseStatus: status }, { new: true });
        if (!machine)
            return res.status(404).json({ success: false, message: 'Machine not found' });
        res.json({ success: true, data: machine });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.updateReleaseStatus = updateReleaseStatus;
const discontinueMachine = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const machine = yield RDMachine_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId }, { isDiscontinued: true }, { new: true });
        if (!machine)
            return res.status(404).json({ success: false, message: 'Machine not found' });
        res.json({ success: true, data: machine });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.discontinueMachine = discontinueMachine;
const reactivateMachine = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const machine = yield RDMachine_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId }, { isDiscontinued: false }, { new: true });
        if (!machine)
            return res.status(404).json({ success: false, message: 'Machine not found' });
        res.json({ success: true, data: machine });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.reactivateMachine = reactivateMachine;
// ─── BOMs ─────────────────────────────────────────────────────────────────────
const getBOMs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const boms = yield RDBOM_js_1.default.find({ company: req.user.companyId }).populate('machine', 'code name');
        res.json({ success: true, data: boms });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getBOMs = getBOMs;
const getBOMForMachine = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const bom = yield RDBOM_js_1.default.findOne({ machine: req.params.machineId, company: req.user.companyId });
        res.json({ success: true, data: bom || null });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getBOMForMachine = getBOMForMachine;
const createBOM = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { machineId } = req.body;
        if (!machineId)
            return res.status(400).json({ success: false, message: 'machineId is required' });
        const existing = yield RDBOM_js_1.default.findOne({ machine: machineId, company: req.user.companyId });
        if (existing)
            return res.status(400).json({ success: false, message: 'BOM already exists for this machine' });
        const bom = yield RDBOM_js_1.default.create({
            machine: machineId,
            company: req.user.companyId,
            createdBy: req.user._id,
        });
        res.status(201).json({ success: true, data: bom });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.createBOM = createBOM;
const addMaterial = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { code, name, quantity, unit, grade, specification } = req.body;
        if (!code || !name || !quantity || !unit) {
            return res.status(400).json({ success: false, message: 'code, name, quantity, unit are required' });
        }
        const bom = yield RDBOM_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId, isLocked: false }, { $push: { materials: { code, name, quantity: Number(quantity), unit, grade: grade || '', specification: specification || '' } } }, { new: true });
        if (!bom)
            return res.status(404).json({ success: false, message: 'BOM not found or is locked' });
        res.json({ success: true, data: bom });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.addMaterial = addMaterial;
const updateMaterial = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const bom = yield RDBOM_js_1.default.findOne({ _id: req.params.id, company: req.user.companyId });
        if (!bom)
            return res.status(404).json({ success: false, message: 'BOM not found' });
        const mat = bom.materials.id(req.params.materialId);
        if (!mat)
            return res.status(404).json({ success: false, message: 'Material not found' });
        Object.assign(mat, req.body);
        yield bom.save();
        res.json({ success: true, data: bom });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.updateMaterial = updateMaterial;
const deleteMaterial = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const bom = yield RDBOM_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId, isLocked: false }, { $pull: { materials: { _id: req.params.materialId } } }, { new: true });
        if (!bom)
            return res.status(404).json({ success: false, message: 'BOM not found or is locked' });
        res.json({ success: true, data: bom });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.deleteMaterial = deleteMaterial;
const lockBOM = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const bom = yield RDBOM_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId }, { isLocked: true, lockedAt: today() }, { new: true });
        if (!bom)
            return res.status(404).json({ success: false, message: 'BOM not found' });
        res.json({ success: true, data: bom });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.lockBOM = lockBOM;
const discontinueMaterial = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const bom = yield RDBOM_js_1.default.findOne({ _id: req.params.id, company: req.user.companyId });
        if (!bom)
            return res.status(404).json({ success: false, message: 'BOM not found' });
        const mat = bom.materials.id(req.params.materialId);
        if (!mat)
            return res.status(404).json({ success: false, message: 'Material not found' });
        mat.isDiscontinued = true;
        yield bom.save();
        res.json({ success: true, data: bom });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.discontinueMaterial = discontinueMaterial;
const reactivateMaterial = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const bom = yield RDBOM_js_1.default.findOne({ _id: req.params.id, company: req.user.companyId });
        if (!bom)
            return res.status(404).json({ success: false, message: 'BOM not found' });
        const mat = bom.materials.id(req.params.materialId);
        if (!mat)
            return res.status(404).json({ success: false, message: 'Material not found' });
        mat.isDiscontinued = false;
        yield bom.save();
        res.json({ success: true, data: bom });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.reactivateMaterial = reactivateMaterial;
// ─── PROTOTYPES ───────────────────────────────────────────────────────────────
function deriveStatus(perf, output, dur) {
    if (perf === 'Fail' || output === 'Fail' || dur === 'Fail')
        return 'Failed';
    if (perf === 'Pass' && output === 'Pass' && dur === 'Pass')
        return 'Passed';
    return 'In Progress';
}
const getPrototypes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const prototypes = yield RDPrototype_js_1.default.find({ company: req.user.companyId }).sort({ createdAt: -1 });
        res.json({ success: true, data: prototypes });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getPrototypes = getPrototypes;
const createPrototype = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { machineId, machineName, machineCode, prototypeName, performanceTest, outputTest, durabilityTest, testNotes, testedBy } = req.body;
        if (!machineId || !prototypeName) {
            return res.status(400).json({ success: false, message: 'machineId and prototypeName are required' });
        }
        const perf = performanceTest || 'Pending';
        const out = outputTest || 'Pending';
        const dur = durabilityTest || 'Pending';
        const prototype = yield RDPrototype_js_1.default.create({
            machine: machineId, machineName, machineCode, prototypeName,
            performanceTest: perf, outputTest: out, durabilityTest: dur,
            status: deriveStatus(perf, out, dur),
            testNotes: testNotes || '',
            testedBy: testedBy || '',
            company: req.user.companyId,
            createdBy: req.user._id,
        });
        res.status(201).json({ success: true, data: prototype });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.createPrototype = createPrototype;
const updatePrototype = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const proto = yield RDPrototype_js_1.default.findOne({ _id: req.params.id, company: req.user.companyId });
        if (!proto)
            return res.status(404).json({ success: false, message: 'Prototype not found' });
        const updates = req.body;
        Object.assign(proto, updates);
        const perf = proto.performanceTest;
        const out = proto.outputTest;
        const dur = proto.durabilityTest;
        proto.status = deriveStatus(perf, out, dur);
        if (proto.status === 'Passed' && !proto.passedDate)
            proto.passedDate = today();
        yield proto.save();
        res.json({ success: true, data: proto });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.updatePrototype = updatePrototype;
// ─── CHANGE REQUESTS ──────────────────────────────────────────────────────────
const getChangeRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const requests = yield RDChangeRequest_js_1.default.find({ company: req.user.companyId }).sort({ createdAt: -1 });
        res.json({ success: true, data: requests });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getChangeRequests = getChangeRequests;
const createChangeRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { machineId, machineName, machineCode, raisedBy, department, changeType, description } = req.body;
        if (!machineId || !raisedBy || !department || !changeType || !description) {
            return res.status(400).json({ success: false, message: 'machineId, raisedBy, department, changeType, description are required' });
        }
        const changeId = yield generateChangeId(req.user.companyId);
        const cr = yield RDChangeRequest_js_1.default.create({
            changeId, machine: machineId, machineName, machineCode,
            raisedBy, department, changeType, description,
            raisedAt: today(),
            company: req.user.companyId,
            createdBy: req.user._id,
        });
        res.status(201).json({ success: true, data: cr });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.createChangeRequest = createChangeRequest;
const resolveChangeRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { approved, notes } = req.body;
        const cr = yield RDChangeRequest_js_1.default.findOneAndUpdate({ _id: req.params.id, company: req.user.companyId }, { status: approved ? 'Approved' : 'Rejected', rdNotes: notes || '', resolvedAt: today() }, { new: true });
        if (!cr)
            return res.status(404).json({ success: false, message: 'Change request not found' });
        res.json({ success: true, data: cr });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.resolveChangeRequest = resolveChangeRequest;
// ─── TOOL PROCESSES ───────────────────────────────────────────────────────────
const getToolProcesses = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const items = yield RDToolProcess_js_1.default.find({ company: req.user.companyId });
        res.json({ success: true, data: items });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getToolProcesses = getToolProcesses;
function ensureToolProcess(machineId, companyId, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        let tp = yield RDToolProcess_js_1.default.findOne({ machine: machineId, company: companyId });
        if (!tp) {
            tp = yield RDToolProcess_js_1.default.create({ machine: machineId, company: companyId, createdBy: userId });
        }
        return tp;
    });
}
const addTool = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { code, name, specification, quantity, unit } = req.body;
        if (!code || !name)
            return res.status(400).json({ success: false, message: 'code and name are required' });
        const tp = yield ensureToolProcess(req.params.machineId, req.user.companyId, req.user._id);
        tp.tools.push({ code, name, specification: specification || '', quantity: Number(quantity) || 1, unit: unit || 'pcs' });
        yield tp.save();
        res.json({ success: true, data: tp });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.addTool = addTool;
const removeTool = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const tp = yield RDToolProcess_js_1.default.findOne({ machine: req.params.machineId, company: req.user.companyId });
        if (!tp)
            return res.status(404).json({ success: false, message: 'Not found' });
        tp.tools.pull({ _id: req.params.toolId });
        yield tp.save();
        res.json({ success: true, data: tp });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.removeTool = removeTool;
const discontinueTool = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const tp = yield RDToolProcess_js_1.default.findOne({ machine: req.params.machineId, company: req.user.companyId });
        if (!tp)
            return res.status(404).json({ success: false, message: 'Not found' });
        const tool = tp.tools.id(req.params.toolId);
        if (!tool)
            return res.status(404).json({ success: false, message: 'Tool not found' });
        tool.isDiscontinued = true;
        yield tp.save();
        res.json({ success: true, data: tp });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.discontinueTool = discontinueTool;
const reactivateTool = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const tp = yield RDToolProcess_js_1.default.findOne({ machine: req.params.machineId, company: req.user.companyId });
        if (!tp)
            return res.status(404).json({ success: false, message: 'Not found' });
        const tool = tp.tools.id(req.params.toolId);
        if (!tool)
            return res.status(404).json({ success: false, message: 'Tool not found' });
        tool.isDiscontinued = false;
        yield tp.save();
        res.json({ success: true, data: tp });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.reactivateTool = reactivateTool;
const addProcess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { step, type, description, duration, tool } = req.body;
        if (!step || !type)
            return res.status(400).json({ success: false, message: 'step and type are required' });
        const tp = yield ensureToolProcess(req.params.machineId, req.user.companyId, req.user._id);
        tp.processes.push({ step: Number(step), type, description: description || '', duration: duration || '', tool: tool || '' });
        yield tp.save();
        res.json({ success: true, data: tp });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.addProcess = addProcess;
const removeProcess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const tp = yield RDToolProcess_js_1.default.findOne({ machine: req.params.machineId, company: req.user.companyId });
        if (!tp)
            return res.status(404).json({ success: false, message: 'Not found' });
        tp.processes.pull({ _id: req.params.processId });
        yield tp.save();
        res.json({ success: true, data: tp });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.removeProcess = removeProcess;
// ─── QUALITY PARAMS ───────────────────────────────────────────────────────────
const getQualityParams = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const items = yield RDQualityParam_js_1.default.find({ company: req.user.companyId });
        res.json({ success: true, data: items });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getQualityParams = getQualityParams;
function ensureQualityParam(machineId, machineName, companyId, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        let qp = yield RDQualityParam_js_1.default.findOne({ machine: machineId, company: companyId });
        if (!qp) {
            qp = yield RDQualityParam_js_1.default.create({ machine: machineId, machineName, company: companyId, createdBy: userId });
        }
        return qp;
    });
}
const addQualityParam = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { machineId, machineName, parameter, tolerance, performanceStandard } = req.body;
        if (!machineId || !parameter)
            return res.status(400).json({ success: false, message: 'machineId and parameter are required' });
        const qp = yield ensureQualityParam(machineId, machineName, req.user.companyId, req.user._id);
        qp.parameters.push({ parameter, tolerance: tolerance || '', performanceStandard: performanceStandard || '' });
        yield qp.save();
        res.json({ success: true, data: qp });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.addQualityParam = addQualityParam;
const deleteQualityParam = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const qp = yield RDQualityParam_js_1.default.findOne({ machine: req.params.machineId, company: req.user.companyId });
        if (!qp)
            return res.status(404).json({ success: false, message: 'Not found' });
        qp.parameters.pull({ _id: req.params.paramId });
        yield qp.save();
        res.json({ success: true, data: qp });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.deleteQualityParam = deleteQualityParam;
const addQCItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { machineId, machineName, item } = req.body;
        if (!machineId || !item)
            return res.status(400).json({ success: false, message: 'machineId and item are required' });
        const qp = yield ensureQualityParam(machineId, machineName, req.user.companyId, req.user._id);
        qp.qcChecklist.push({ item });
        yield qp.save();
        res.json({ success: true, data: qp });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.addQCItem = addQCItem;
const deleteQCItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const qp = yield RDQualityParam_js_1.default.findOne({ machine: req.params.machineId, company: req.user.companyId });
        if (!qp)
            return res.status(404).json({ success: false, message: 'Not found' });
        qp.qcChecklist.pull({ _id: req.params.itemId });
        yield qp.save();
        res.json({ success: true, data: qp });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.deleteQCItem = deleteQCItem;
// ─── DOCUMENTS ────────────────────────────────────────────────────────────────
const getDocuments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const docs = yield RDDocument_js_1.default.find({ company: req.user.companyId }).sort({ createdAt: -1 });
        res.json({ success: true, data: docs });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.getDocuments = getDocuments;
const createDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { machineId, machineCode, machineName, name, type, version, notes, uploadedBy } = req.body;
        if (!machineId || !type) {
            if (req.file)
                fs_1.default.unlinkSync(req.file.path);
            return res.status(400).json({ success: false, message: 'machineId and type are required' });
        }
        let mCode = machineCode, mName = machineName;
        if (!mCode || !mName) {
            const machine = yield RDMachine_js_1.default.findById(machineId).select('code name');
            mCode = (machine === null || machine === void 0 ? void 0 : machine.code) || '';
            mName = (machine === null || machine === void 0 ? void 0 : machine.name) || '';
        }
        const originalName = req.file ? req.file.originalname : (name || '');
        const docName = name || originalName;
        const fileUrl = req.file ? `/uploads/rd-docs/${req.file.filename}` : '';
        const fileSize = req.file
            ? (req.file.size / (1024 * 1024)).toFixed(1) + ' MB'
            : '';
        const doc = yield RDDocument_js_1.default.create({
            machine: machineId, machineCode: mCode, machineName: mName,
            name: docName, type,
            version: version || 'v1.0',
            size: fileSize,
            fileUrl,
            originalName,
            notes: notes || '',
            uploadedBy: uploadedBy || 'R&D Team', uploadedAt: today(),
            company: req.user.companyId,
            createdBy: req.user._id,
        });
        res.status(201).json({ success: true, data: doc });
    }
    catch (err) {
        if (req.file)
            fs_1.default.unlinkSync(req.file.path);
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.createDocument = createDocument;
const deleteDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const doc = yield RDDocument_js_1.default.findOneAndDelete({ _id: req.params.id, company: req.user.companyId });
        if (!doc)
            return res.status(404).json({ success: false, message: 'Document not found' });
        if (doc.fileUrl) {
            const filePath = doc.fileUrl.replace(/^\//, '');
            if (fs_1.default.existsSync(filePath))
                fs_1.default.unlinkSync(filePath);
        }
        res.json({ success: true, data: doc });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
exports.deleteDocument = deleteDocument;
