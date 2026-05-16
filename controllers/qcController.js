import QCJob from '../models/QCJob.js';

const today = () => new Date().toISOString().split('T')[0];

async function generateQCJobId(companyId) {
  const year = new Date().getFullYear();
  const count = await QCJob.countDocuments({ company: companyId });
  return `QC-${year}-${String(count + 1).padStart(4, '0')}`;
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
    const { status, source, category } = req.query;
    const filter = { company: req.user.companyId };
    if (status) filter.status = status;
    if (source) filter.source = source;
    if (category) filter.category = category;
    const jobs = await QCJob.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: jobs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getQCJob = async (req, res) => {
  try {
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId }).lean();
    if (!job) return res.status(404).json({ success: false, message: 'QC job not found' });
    res.json({ success: true, data: job });
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

    const qcJobId = await generateQCJobId(req.user.companyId);

    const job = await QCJob.create({
      qcJobId,
      source, sourceRefId, sourceDepartment, sentBy,
      itemName, itemCode, category,
      quantity: quantity || 1,
      unit: unit || 'pcs',
      receivedDate,
      checklist: (checklist || []).map(c => ({
        parameter: c.parameter,
        standardValue: c.standardValue || '',
        actualValue: '',
        status: 'Pending',
        remarks: '',
      })),
      notes: notes || '',
      company: req.user.companyId,
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, data: job });
  } catch (err) {
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
    const job = await QCJob.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId, status: 'Pending' },
      { status: 'In Progress', inspector: inspector || req.user.fullName || '', inspectionStartDate: today() },
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
    const { actualValue, status, remarks } = req.body;

    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const item = job.checklist.id(itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Checklist item not found' });

    if (actualValue !== undefined) item.actualValue = actualValue;
    if (status !== undefined) item.status = status;
    if (remarks !== undefined) item.remarks = remarks;

    await job.save();
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const submitDecision = async (req, res) => {
  try {
    const { decision, failReason, inspectorRemarks } = req.body;
    if (!decision || !['Pass', 'Fail'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'decision must be Pass or Fail' });
    }
    if (decision === 'Fail' && !failReason) {
      return res.status(400).json({ success: false, message: 'failReason is required when decision is Fail' });
    }

    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId, status: 'In Progress' });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found or not In Progress' });

    job.decision = decision;
    job.status = decision === 'Pass' ? 'Approved' : 'Rejected';
    job.inspectionEndDate = today();
    job.failReason = failReason || '';
    job.inspectorRemarks = inspectorRemarks || '';

    if (decision === 'Pass') job.transferredToStore = true;
    if (decision === 'Fail') job.returnedToSource = true;

    await job.save();
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
