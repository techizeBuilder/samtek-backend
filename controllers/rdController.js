import RDMachine from '../models/RDMachine.js';
import RDBOM from '../models/RDBOM.js';
import RDPrototype from '../models/RDPrototype.js';
import RDChangeRequest from '../models/RDChangeRequest.js';
import RDToolProcess from '../models/RDToolProcess.js';
import RDQualityParam from '../models/RDQualityParam.js';
import RDDocument from '../models/RDDocument.js';
import RDRequest from '../models/RDRequest.js';
import ProductionOrder from '../models/ProductionOrder.js';
import RDMasterOption from '../models/RDMasterOption.js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';


const today = () => new Date().toISOString().split('T')[0];

async function generateChangeId(companyId) {
  const year = new Date().getFullYear();

  const count = await RDChangeRequest.countDocuments({
    company: companyId
  });

  const companyCode = companyId.toString().slice(-4);

  return `CR-${companyCode}-${year}-${String(count + 1).padStart(3, '0')}`;
}

// ─── MACHINES ─────────────────────────────────────────────────────────────────

import RDMachine from '../models/RDMachine.js';
import RDDocument from '../models/RDDocument.js';

export const getMachines = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    // 1. Fetch all machines for the company (.lean() makes it plain JSON so we can add properties)
    const machines = await RDMachine.find({ company: companyId })
      .sort({ createdAt: -1 })
      .lean();

    if (machines.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // 2. Fetch all Design Files for these machines
    const machineIds = machines.map(m => m._id);
    const designDocuments = await RDDocument.find({
      company: companyId,
      machine: { $in: machineIds },
      type: 'Design Files' // Only pulling design files for the approval workflow
    }).lean();

    // 3. Group the design files by machine ID
    const docsByMachine = {};
    designDocuments.forEach(doc => {
      const mId = doc.machine.toString();
      if (!docsByMachine[mId]) {
        docsByMachine[mId] = [];
      }
      docsByMachine[mId].push(doc);
    });

    // 4. Attach the grouped documents to their respective machines
    const enrichedMachines = machines.map(machine => ({
      ...machine,
      // This feeds the files directly into the frontend response
      designFiles: docsByMachine[machine._id.toString()] || []
    }));

    res.json({ success: true, data: enrichedMachines });
  } catch (err) {
    console.error('Error fetching machines with design files:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};



// ─── 1. CREATE MACHINE ─────────────────────────────────────────────────────────
export const createMachine = async (req, res) => {
  try {
    const {
      code, name, description,
      category, pType, pSourceType,
      brand, machineType,
      specifications
    } = req.body;

    // Strict validation for required fields
    if (!code || !name || !category || !pType || !pSourceType) {
      return res.status(400).json({
        success: false,
        message: 'Product Code, Name, Category, P-Type, and P-Source Type are required.'
      });
    }

    const machine = await RDMachine.create({
      code,
      name,
      description: description || '',
      category,
      pType,
      pSourceType,
      brand: brand || '',
      machineType: machineType || 'Standard',
      specifications: specifications || [],
      company: req.user.companyId,
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, data: machine });
  } catch (err) {
    // Handle potential duplicate code errors gracefully
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'Product Code already exists.' });
    }
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

// ─── 2. GET DYNAMIC DROPDOWN OPTIONS (Call this when page loads) ───────────────
export const getDropdownOptions = async (req, res) => {
  try {
    const options = await RDMasterOption.find({ company: req.user.companyId }).lean();

    // Group them for the frontend so they are easy to use in different selects
    const groupedOptions = {
      Category: options.filter(o => o.field === 'Category').map(o => o.value),
      PType: options.filter(o => o.field === 'P-Type').map(o => o.value),
      PSourceType: options.filter(o => o.field === 'P-SourceType').map(o => o.value),
    };

    res.json({ success: true, data: groupedOptions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ─── 3. ADD NEW DROPDOWN OPTION (Call this when user clicks the "+" icon) ──────
export const addDropdownOption = async (req, res) => {
  try {
    const { field, value } = req.body;

    if (!['Category', 'P-Type', 'P-SourceType'].includes(field)) {
      return res.status(400).json({ success: false, message: 'Invalid field type.' });
    }
    if (!value || value.trim() === '') {
      return res.status(400).json({ success: false, message: 'Option value cannot be empty.' });
    }

    const newOption = await RDMasterOption.create({
      field,
      value: value.trim(),
      company: req.user.companyId
    });

    res.status(201).json({ success: true, data: newOption });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'This option already exists.' });
    }
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


// ─── CREATE BOM (WITH SOURCE TYPE VALIDATION) ─────────────────────────────────
export const createBOM = async (req, res) => {
  try {
    const { machineId, variant } = req.body;
    if (!machineId) return res.status(400).json({ success: false, message: 'machineId is required' });

    // 1. Fetch Machine and Validate P-Source Type
    const machine = await RDMachine.findOne({ _id: machineId, company: req.user.companyId });
    if (!machine) return res.status(404).json({ success: false, message: 'Machine not found' });

    const validSources = ['In House Manufacturing', 'Out Source Manufactured'];
    if (!validSources.includes(machine.pSourceType)) {
      return res.status(400).json({
        success: false,
        message: `BOM creation blocked. P-Source Type must be In House or Out Source. Current: ${machine.pSourceType}`
      });
    }

    const existing = await RDBOM.findOne({ machine: machineId, company: req.user.companyId });
    if (existing) return res.status(400).json({ success: false, message: 'BOM already exists for this machine' });

    const bom = await RDBOM.create({
      machine: machineId,
      variant: variant || 'Standard',
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
    // 1. Extract 'code' alongside the new fields
    const { code, childPart, subChildPart, item, itemType, quantity, unit } = req.body;

    // 2. Validate that 'code' is present
    if (!code || !item || !itemType || !quantity || !unit) {
      return res.status(400).json({
        success: false,
        message: 'code, item, itemType, quantity, and unit are required'
      });
    }

    // 3. Push all fields to the materials array
    const bom = await RDBOM.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, isLocked: false },
      {
        $push: {
          materials: {
            code, // Injecting explicit material code
            childPart,
            subChildPart,
            item,
            itemType,
            quantity: Number(quantity),
            unit
          }
        }
      },
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
    // 1. Fetch BOM with Machine Details
    const bom = await RDBOM.findOne({ _id: req.params.id, company: req.user.companyId }).populate('machine');
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    if (bom.isLocked) return res.status(400).json({ success: false, message: 'BOM is already locked' });

    // 2. Setup PDF Generation
    const filename = `BOM_${bom.machine.code}_${Date.now()}.pdf`;
    const filepath = path.join(process.cwd(), 'uploads', 'rd-docs', filename);

    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    // 3. Write PDF Header
    doc.fontSize(20).text(`Master Bill of Materials`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Machine Code: ${bom.machine.code}`);
    doc.text(`Machine Name: ${bom.machine.name}`);
    doc.text(`Variant: ${bom.variant}`);
    doc.text(`Version: ${bom.version}`);
    doc.text(`Date Locked: ${today()}`);
    doc.moveDown();

    // 4. Write PDF Rows
    doc.fontSize(14).text('Items:', { underline: true });
    doc.fontSize(10);
    bom.materials.forEach((mat, idx) => {
      // Formats nicely: 1. Body > Door | Sheet Metal | Laser Cutting | 2 pcs
      const hierarchy = [mat.childPart, mat.subChildPart].filter(Boolean).join(' > ');
      const prefix = hierarchy ? `${hierarchy} | ` : '';
      doc.text(`${idx + 1}. ${prefix}${mat.item} (${mat.itemType}) - ${mat.quantity} ${mat.unit}`);
    });

    doc.end();

    // 5. Wait for PDF to finish writing to disk
    await new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    // 6. Create the Document Record Automatically
    await RDDocument.create({
      machine: bom.machine._id,
      machineCode: bom.machine.code,
      machineName: bom.machine.name,
      name: `Auto-Generated BOM (${bom.version})`,
      type: 'BOM',
      version: bom.version,
      size: '0.1 MB', // Standard placeholder size for basic text PDFs
      fileUrl: `/uploads/rd-docs/${filename}`,
      originalName: filename,
      notes: 'Automatically generated and uploaded by system upon BOM Lock.',
      uploadedBy: 'System Automation',
      uploadedAt: today(),
      company: req.user.companyId,
      createdBy: req.user._id,
    });

    // 7. Lock the BOM
    bom.isLocked = true;
    bom.lockedAt = today();
    await bom.save();

    res.json({ success: true, data: bom, message: 'BOM locked and PDF generated successfully.' });
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



// ─── 1. GET LIST VIEW (WITH TABS, SEARCH, FILTER & PAGINATION) ─────────────
// ─── 1. GET LIST VIEW (WITH TABS, SEARCH, FILTER & PAGINATION) ─────────────
export const getRDRequests = async (req, res) => {
  try {
    // 1. Added `requestType` to the extracted query variables
    const { tab, search, status, requestType, page = 1 } = req.query;
    const companyId = req.user.companyId;

    const query = { company: companyId };

    // Tab Logic
    if (tab === 'history') {
      query.status = { $in: ['Approved', 'Rejected'] };
    } else {
      query.status = 'Pending'; // Fresh requests waiting for R&D action
    }

    // Explicit Status Filter
    if (status && status !== 'All') {
      query.status = status;
    }

    // ── NEW: Explicit Type Filter ──
    // Allows the frontend to filter by "Initial BOM" vs "Material Change"
    if (requestType && requestType !== 'All') {
      query.requestType = requestType;
    }

    // ── IMPROVED: Smart Search ──
    if (search) {
      query.$or = [
        { machineCode: { $regex: search, $options: 'i' } },
        { machineName: { $regex: search, $options: 'i' } },
        // Now R&D can search by the specific material code/name requested!
        { "materialChangeDetails.materialCode": { $regex: search, $options: 'i' } },
        { "materialChangeDetails.materialName": { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination Logic
    const limit = 20;
    const currentPage = Math.max(1, parseInt(page, 10)); // Ensure page is at least 1
    const skip = (currentPage - 1) * limit;

    // Get total count of documents matching the query (for frontend pagination UI)
    const total = await RDRequest.countDocuments(query);

    // Fetch the actual paginated data
    const requests = await RDRequest.find(query)
      .populate('productionOrderId', 'orderId priority receivedDate deliveryDate status source')
      .sort({ createdAt: -1 })
      .skip(skip)   // Skip previous pages
      .limit(limit) // Limit to 20 items
      .lean();

    res.json({
      success: true,
      data: requests,
      pagination: {
        total,
        page: currentPage,
        pages: Math.ceil(total / limit),
        limit
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


export const processRDRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, rejectReason } = req.body;
    const companyId = req.user.companyId;

    const rdRequest = await RDRequest.findOne({ _id: id, company: companyId });
    if (!rdRequest) return res.status(404).json({ success: false, message: 'R&D Request not found.' });
    if (rdRequest.status !== 'Pending') return res.status(400).json({ success: false, message: `Already ${rdRequest.status}.` });

    // ─────────────────────────────────────────────────────────────
    // SCENARIO A: HANDLING REJECTIONS
    // ─────────────────────────────────────────────────────────────
    if (action === 'Reject') {
      rdRequest.status = 'Rejected';
      await rdRequest.save();

      if (rdRequest.requestType === 'Material Change') {
        // Unlock the specific material and mark it rejected
        await ProductionOrder.findOneAndUpdate(
          { _id: rdRequest.productionOrderId, "materialDemands.materialCode": rdRequest.materialChangeDetails.materialCode },
          { $set: { "materialDemands.$.status": "R&D Rejected" } }
        );
        return res.json({ success: true, message: 'Material change rejected.' });
      } else {
        // Original logic: Put the whole production order on hold
        await ProductionOrder.findByIdAndUpdate(rdRequest.productionOrderId, {
          rdRequestRaised: false,
          status: 'On Hold',
          notes: `R&D Rejected: ${rejectReason || 'No reason provided.'}`
        });
        return res.json({ success: true, message: 'Initial BOM rejected. Order on hold.' });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // SCENARIO B: HANDLING APPROVALS
    // ─────────────────────────────────────────────────────────────
    if (action === 'Approve') {

      // ── WORKFLOW 1: MATERIAL CHANGE APPROVAL ──
      if (rdRequest.requestType === 'Material Change') {
        // Unlock the specific material so Production can raise purchase/issue
        await ProductionOrder.findOneAndUpdate(
          { _id: rdRequest.productionOrderId, "materialDemands.materialCode": rdRequest.materialChangeDetails.materialCode },
          { $set: { "materialDemands.$.status": "Requested" } } // Unlocked!
        );

        rdRequest.status = 'Approved';
        await rdRequest.save();
        return res.json({ success: true, message: 'Material change approved. Production can now request the items.' });
      }

      // ── WORKFLOW 2: INITIAL BOM APPROVAL (Your original code) ──
      const machineProfile = await RDMachine.findOne({ code: rdRequest.machineCode, company: companyId });
      if (!machineProfile || machineProfile.releaseStatus !== 'Released') {
        return res.status(400).json({ success: false, message: 'Machine profile missing or not released.' });
      }

      const masterBOM = await RDBOM.findOne({ machine: machineProfile._id, company: companyId });
      if (!masterBOM || masterBOM.materials.length === 0) {
        return res.status(400).json({ success: false, message: 'No materials found in Master BOM.' });
      }

      const designDocs = await RDDocument.find({ machine: machineProfile._id, company: companyId, type: 'Design Files' });

      const demandsToPush = masterBOM.materials.map(mat => ({
        materialCode: mat.code,
        materialName: mat.item,
        bomQuantity: mat.quantity,
        quantity: mat.quantity,
        unit: mat.unit,
        status: 'Requested'
      }));

      const docsToPush = designDocs.map(doc => ({ name: doc.name, fileUrl: doc.fileUrl, version: doc.version }));

      await ProductionOrder.findByIdAndUpdate(rdRequest.productionOrderId, {
        $push: { materialDemands: { $each: demandsToPush }, designDocuments: { $each: docsToPush } },
        bomVerified: true, designVerified: true, rdRequestRaised: false, status: 'Pending',
        notes: `BOM & Design approved by R&D on ${new Date().toLocaleDateString()}`
      });

      rdRequest.status = 'Approved';
      await rdRequest.save();

      return res.json({ success: true, message: 'Initial BOM injected into Production Order.' });
    }

    return res.status(400).json({ success: false, message: 'Invalid action.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── 2. NEW API: VIEW BOM AND DESIGN FILES FOR A REQUEST ───────────────────
// GET /api/rd-requests/:id/review
export const getRDRequestReviewData = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    // 1. Find the request to get the target machineCode
    const rdRequest = await RDRequest.findOne({ _id: id, company: companyId });
    if (!rdRequest) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    // 2. Fetch the corresponding R&D Machine Profile
    const machineProfile = await RDMachine.findOne({ code: rdRequest.machineCode, company: companyId }).lean();

    // If R&D hasn't created the machine yet, return empty arrays so the frontend doesn't crash
    if (!machineProfile) {
      return res.json({
        success: true,
        data: { machine: null, bom: null, documents: [] }
      });
    }

    // 3. Fetch Master BOM
    const masterBOM = await RDBOM.findOne({ machine: machineProfile._id, company: companyId }).lean();

    // 4. Fetch ONLY Design Documents
    const designDocs = await RDDocument.find({
      machine: machineProfile._id,
      company: companyId,
      type: 'Design Files'
    }).lean();

    res.json({
      success: true,
      data: {
        machine: machineProfile,
        bom: masterBOM,
        documents: designDocs
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};