import RDMachine from '../models/RDMachine.js';
import RDBOM from '../models/RDBOM.js';
import RDPrototype from '../models/RDPrototype.js';
import RDChangeRequest from '../models/RDChangeRequest.js';
import RDToolProcess from '../models/RDToolProcess.js';
import RDQualityParam from '../models/RDQualityParam.js';
import RDDocument from '../models/RDDocument.js';
import fs from 'fs';

const today = () => new Date().toISOString().split('T')[0];

async function generateChangeId(companyId) {
  const year = new Date().getFullYear();
  const count = await RDChangeRequest.countDocuments({ company: companyId });
  return `CR-${year}-${String(count + 1).padStart(3, '0')}`;
}

// ─── MACHINES ─────────────────────────────────────────────────────────────────

export const getMachines = async (req, res) => {
  try {
    const machines = await RDMachine.find({ company: req.user.companyId }).sort({ createdAt: -1 });
    res.json({ success: true, data: machines });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createMachine = async (req, res) => {
  try {
    const { code, name, category, description, machineType } = req.body;
    if (!code || !name || !category) {
      return res.status(400).json({ success: false, message: 'code, name and category are required' });
    }
    const machine = await RDMachine.create({
      code, name, category, description: description || '',
      machineType: machineType || 'Standard',
      company: req.user.companyId,
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: machine });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateMachine = async (req, res) => {
  try {
    const machine = await RDMachine.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { ...req.body },
      { new: true }
    );
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, data: machine });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateDesignStatus = async (req, res) => {
  try {
    const { status, note } = req.body;
    const update = { designStatus: status };
    if (status === 'Rejected') update.rejectionNote = note || '';
    const machine = await RDMachine.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      update,
      { new: true }
    );
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, data: machine });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateReleaseStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const machine = await RDMachine.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { releaseStatus: status },
      { new: true }
    );
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, data: machine });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const discontinueMachine = async (req, res) => {
  try {
    const machine = await RDMachine.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { isDiscontinued: true },
      { new: true }
    );
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, data: machine });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const reactivateMachine = async (req, res) => {
  try {
    const machine = await RDMachine.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { isDiscontinued: false },
      { new: true }
    );
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });
    res.json({ success: true, data: machine });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── BOMs ─────────────────────────────────────────────────────────────────────

export const getBOMs = async (req, res) => {
  try {
    const boms = await RDBOM.find({ company: req.user.companyId }).populate('machine', 'code name');
    res.json({ success: true, data: boms });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getBOMForMachine = async (req, res) => {
  try {
    const bom = await RDBOM.findOne({ machine: req.params.machineId, company: req.user.companyId });
    res.json({ success: true, data: bom || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createBOM = async (req, res) => {
  try {
    const { machineId } = req.body;
    if (!machineId) return res.status(400).json({ success: false, message: 'machineId is required' });
    const existing = await RDBOM.findOne({ machine: machineId, company: req.user.companyId });
    if (existing) return res.status(400).json({ success: false, message: 'BOM already exists for this machine' });
    const bom = await RDBOM.create({
      machine: machineId,
      company: req.user.companyId,
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addMaterial = async (req, res) => {
  try {
    const { code, name, quantity, unit, grade, specification } = req.body;
    if (!code || !name || !quantity || !unit) {
      return res.status(400).json({ success: false, message: 'code, name, quantity, unit are required' });
    }
    const bom = await RDBOM.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, isLocked: false },
      { $push: { materials: { code, name, quantity: Number(quantity), unit, grade: grade || '', specification: specification || '' } } },
      { new: true }
    );
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found or is locked' });
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateMaterial = async (req, res) => {
  try {
    const bom = await RDBOM.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    const mat = bom.materials.id(req.params.materialId);
    if (!mat) return res.status(404).json({ success: false, message: 'Material not found' });
    Object.assign(mat, req.body);
    await bom.save();
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteMaterial = async (req, res) => {
  try {
    const bom = await RDBOM.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, isLocked: false },
      { $pull: { materials: { _id: req.params.materialId } } },
      { new: true }
    );
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found or is locked' });
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const lockBOM = async (req, res) => {
  try {
    const bom = await RDBOM.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { isLocked: true, lockedAt: today() },
      { new: true }
    );
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const discontinueMaterial = async (req, res) => {
  try {
    const bom = await RDBOM.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    const mat = bom.materials.id(req.params.materialId);
    if (!mat) return res.status(404).json({ success: false, message: 'Material not found' });
    mat.isDiscontinued = true;
    await bom.save();
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const reactivateMaterial = async (req, res) => {
  try {
    const bom = await RDBOM.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    const mat = bom.materials.id(req.params.materialId);
    if (!mat) return res.status(404).json({ success: false, message: 'Material not found' });
    mat.isDiscontinued = false;
    await bom.save();
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PROTOTYPES ───────────────────────────────────────────────────────────────

function deriveStatus(perf, output, dur) {
  if (perf === 'Fail' || output === 'Fail' || dur === 'Fail') return 'Failed';
  if (perf === 'Pass' && output === 'Pass' && dur === 'Pass') return 'Passed';
  return 'In Progress';
}

export const getPrototypes = async (req, res) => {
  try {
    const prototypes = await RDPrototype.find({ company: req.user.companyId }).sort({ createdAt: -1 });
    res.json({ success: true, data: prototypes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createPrototype = async (req, res) => {
  try {
    const { machineId, machineName, machineCode, prototypeName, performanceTest, outputTest, durabilityTest, testNotes, testedBy } = req.body;
    if (!machineId || !prototypeName) {
      return res.status(400).json({ success: false, message: 'machineId and prototypeName are required' });
    }
    const perf = performanceTest || 'Pending';
    const out = outputTest || 'Pending';
    const dur = durabilityTest || 'Pending';
    const prototype = await RDPrototype.create({
      machine: machineId, machineName, machineCode, prototypeName,
      performanceTest: perf, outputTest: out, durabilityTest: dur,
      status: deriveStatus(perf, out, dur),
      testNotes: testNotes || '',
      testedBy: testedBy || '',
      company: req.user.companyId,
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: prototype });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updatePrototype = async (req, res) => {
  try {
    const proto = await RDPrototype.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!proto) return res.status(404).json({ success: false, message: 'Prototype not found' });
    const updates = req.body;
    Object.assign(proto, updates);
    const perf = proto.performanceTest;
    const out = proto.outputTest;
    const dur = proto.durabilityTest;
    proto.status = deriveStatus(perf, out, dur);
    if (proto.status === 'Passed' && !proto.passedDate) proto.passedDate = today();
    await proto.save();
    res.json({ success: true, data: proto });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CHANGE REQUESTS ──────────────────────────────────────────────────────────

export const getChangeRequests = async (req, res) => {
  try {
    const requests = await RDChangeRequest.find({ company: req.user.companyId }).sort({ createdAt: -1 });
    res.json({ success: true, data: requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createChangeRequest = async (req, res) => {
  try {
    const { machineId, machineName, machineCode, raisedBy, department, changeType, description } = req.body;
    if (!machineId || !raisedBy || !department || !changeType || !description) {
      return res.status(400).json({ success: false, message: 'machineId, raisedBy, department, changeType, description are required' });
    }
    const changeId = await generateChangeId(req.user.companyId);
    const cr = await RDChangeRequest.create({
      changeId, machine: machineId, machineName, machineCode,
      raisedBy, department, changeType, description,
      raisedAt: today(),
      company: req.user.companyId,
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: cr });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const resolveChangeRequest = async (req, res) => {
  try {
    const { approved, notes } = req.body;
    const cr = await RDChangeRequest.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { status: approved ? 'Approved' : 'Rejected', rdNotes: notes || '', resolvedAt: today() },
      { new: true }
    );
    if (!cr) return res.status(404).json({ success: false, message: 'Change request not found' });
    res.json({ success: true, data: cr });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── TOOL PROCESSES ───────────────────────────────────────────────────────────

export const getToolProcesses = async (req, res) => {
  try {
    const items = await RDToolProcess.find({ company: req.user.companyId });
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

async function ensureToolProcess(machineId, companyId, userId) {
  let tp = await RDToolProcess.findOne({ machine: machineId, company: companyId });
  if (!tp) {
    tp = await RDToolProcess.create({ machine: machineId, company: companyId, createdBy: userId });
  }
  return tp;
}

export const addTool = async (req, res) => {
  try {
    const { code, name, specification, quantity, unit } = req.body;
    if (!code || !name) return res.status(400).json({ success: false, message: 'code and name are required' });
    const tp = await ensureToolProcess(req.params.machineId, req.user.companyId, req.user._id);
    tp.tools.push({ code, name, specification: specification || '', quantity: Number(quantity) || 1, unit: unit || 'pcs' });
    await tp.save();
    res.json({ success: true, data: tp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const removeTool = async (req, res) => {
  try {
    const tp = await RDToolProcess.findOne({ machine: req.params.machineId, company: req.user.companyId });
    if (!tp) return res.status(404).json({ success: false, message: 'Not found' });
    tp.tools.pull({ _id: req.params.toolId });
    await tp.save();
    res.json({ success: true, data: tp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const discontinueTool = async (req, res) => {
  try {
    const tp = await RDToolProcess.findOne({ machine: req.params.machineId, company: req.user.companyId });
    if (!tp) return res.status(404).json({ success: false, message: 'Not found' });
    const tool = tp.tools.id(req.params.toolId);
    if (!tool) return res.status(404).json({ success: false, message: 'Tool not found' });
    tool.isDiscontinued = true;
    await tp.save();
    res.json({ success: true, data: tp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const reactivateTool = async (req, res) => {
  try {
    const tp = await RDToolProcess.findOne({ machine: req.params.machineId, company: req.user.companyId });
    if (!tp) return res.status(404).json({ success: false, message: 'Not found' });
    const tool = tp.tools.id(req.params.toolId);
    if (!tool) return res.status(404).json({ success: false, message: 'Tool not found' });
    tool.isDiscontinued = false;
    await tp.save();
    res.json({ success: true, data: tp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addProcess = async (req, res) => {
  try {
    const { step, type, description, duration, tool } = req.body;
    if (!step || !type) return res.status(400).json({ success: false, message: 'step and type are required' });
    const tp = await ensureToolProcess(req.params.machineId, req.user.companyId, req.user._id);
    tp.processes.push({ step: Number(step), type, description: description || '', duration: duration || '', tool: tool || '' });
    await tp.save();
    res.json({ success: true, data: tp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const removeProcess = async (req, res) => {
  try {
    const tp = await RDToolProcess.findOne({ machine: req.params.machineId, company: req.user.companyId });
    if (!tp) return res.status(404).json({ success: false, message: 'Not found' });
    tp.processes.pull({ _id: req.params.processId });
    await tp.save();
    res.json({ success: true, data: tp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── QUALITY PARAMS ───────────────────────────────────────────────────────────

export const getQualityParams = async (req, res) => {
  try {
    const items = await RDQualityParam.find({ company: req.user.companyId });
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

async function ensureQualityParam(machineId, machineName, companyId, userId) {
  let qp = await RDQualityParam.findOne({ machine: machineId, company: companyId });
  if (!qp) {
    qp = await RDQualityParam.create({ machine: machineId, machineName, company: companyId, createdBy: userId });
  }
  return qp;
}

export const addQualityParam = async (req, res) => {
  try {
    const { machineId, machineName, parameter, tolerance, performanceStandard } = req.body;
    if (!machineId || !parameter) return res.status(400).json({ success: false, message: 'machineId and parameter are required' });
    const qp = await ensureQualityParam(machineId, machineName, req.user.companyId, req.user._id);
    qp.parameters.push({ parameter, tolerance: tolerance || '', performanceStandard: performanceStandard || '' });
    await qp.save();
    res.json({ success: true, data: qp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteQualityParam = async (req, res) => {
  try {
    const qp = await RDQualityParam.findOne({ machine: req.params.machineId, company: req.user.companyId });
    if (!qp) return res.status(404).json({ success: false, message: 'Not found' });
    qp.parameters.pull({ _id: req.params.paramId });
    await qp.save();
    res.json({ success: true, data: qp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addQCItem = async (req, res) => {
  try {
    const { machineId, machineName, item } = req.body;
    if (!machineId || !item) return res.status(400).json({ success: false, message: 'machineId and item are required' });
    const qp = await ensureQualityParam(machineId, machineName, req.user.companyId, req.user._id);
    qp.qcChecklist.push({ item });
    await qp.save();
    res.json({ success: true, data: qp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteQCItem = async (req, res) => {
  try {
    const qp = await RDQualityParam.findOne({ machine: req.params.machineId, company: req.user.companyId });
    if (!qp) return res.status(404).json({ success: false, message: 'Not found' });
    qp.qcChecklist.pull({ _id: req.params.itemId });
    await qp.save();
    res.json({ success: true, data: qp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── DOCUMENTS ────────────────────────────────────────────────────────────────

export const getDocuments = async (req, res) => {
  try {
    const docs = await RDDocument.find({ company: req.user.companyId }).sort({ createdAt: -1 });
    res.json({ success: true, data: docs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createDocument = async (req, res) => {
  try {
    const { machineId, machineCode, machineName, name, type, version, notes, uploadedBy } = req.body;
    if (!machineId || !type) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'machineId and type are required' });
    }
    let mCode = machineCode, mName = machineName;
    if (!mCode || !mName) {
      const machine = await RDMachine.findById(machineId).select('code name');
      mCode = machine?.code || '';
      mName = machine?.name || '';
    }
    const originalName = req.file ? req.file.originalname : (name || '');
    const docName = name || originalName;
    const fileUrl = req.file ? `/uploads/rd-docs/${req.file.filename}` : '';
    const fileSize = req.file
      ? (req.file.size / (1024 * 1024)).toFixed(1) + ' MB'
      : '';
    const doc = await RDDocument.create({
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
  } catch (err) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteDocument = async (req, res) => {
  try {
    const doc = await RDDocument.findOneAndDelete({ _id: req.params.id, company: req.user.companyId });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    if (doc.fileUrl) {
      const filePath = doc.fileUrl.replace(/^\//, '');
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
