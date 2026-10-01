// Product Approval page endpoints (/api/rd/approval/*) — thin HTTP layer over
// services/productApprovalService.js. See
// docs/product-approval-gate-redesign-discussion-2026-09.md.
import { Item } from '../models/Inventory.js';
import {
  APPROVAL_KINDS, approvalOf, isPurchaseMachine,
  computeDesignReadiness, computeReleaseReadiness, computeQcReadiness, getPrototypeStatus,
  setDesignApproved, setBomApproved, setQcListApproved, setReleaseStatus, listApprovalItems,
} from '../services/productApprovalService.js';
import { buildMachineDesignFiles } from './rdController.js';

const respond = (res, result) => {
  if (!result.ok) {
    return res.status(result.status).json({ success: false, message: result.message, ...(result.blockers ? { blockers: result.blockers } : {}) });
  }
  const a = approvalOf(result.item);
  res.json({ success: true, data: { _id: String(result.item._id), productKind: result.item.productKind, ...a } });
};
const fail500 = (res, err) => res.status(500).json({ success: false, message: err.message });

// GET /approval/items?kind=Machine|ChildPart|SubChildPart&search=&page=&limit=
export const getApprovalItems = async (req, res) => {
  try {
    const { kind, search } = req.query;
    if (!APPROVAL_KINDS.includes(kind)) return res.status(400).json({ success: false, message: `kind must be one of ${APPROVAL_KINDS.join(', ')}` });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const data = await listApprovalItems({ companyId: req.user.companyId, kind, search: search || '', page, limit });
    res.json({ success: true, ...data });
  } catch (err) { fail500(res, err); }
};

// GET /approval/items/:id — the View dialog: design files + full readiness.
export const getApprovalItemDetail = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const item = await Item.findOne({ _id: req.params.id, companyId, productKind: { $in: APPROVAL_KINDS } }).lean();
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    const designFiles = item.productKind === 'Machine'
      ? await buildMachineDesignFiles(item._id, companyId)
      : (item.image ? [{ _id: `item-${item._id}`, name: `${item.name} (${item.code})`, version: '', fileUrl: item.image, source: 'General' }] : []);
    res.json({
      success: true,
      data: {
        _id: String(item._id), code: item.code, name: item.name, category: item.category, description: item.description || '',
        productKind: item.productKind, purchaseMachine: isPurchaseMachine(item),
        ...approvalOf(item),
        designFiles,
        prototypeStatus: await getPrototypeStatus(item, companyId),
        designReadiness: isPurchaseMachine(item) ? null : await computeDesignReadiness(item, companyId),
        qcReadiness: await computeQcReadiness(item, companyId),
        releaseReadiness: await computeReleaseReadiness(item, companyId),
      },
    });
  } catch (err) { fail500(res, err); }
};

const base = (req) => ({ id: req.params.id, companyId: req.user.companyId, userId: req.user._id });

// PUT /approval/items/:id/design   { approved: boolean }
export const updateItemDesignStatus = async (req, res) => {
  try { respond(res, await setDesignApproved({ ...base(req), approved: !!req.body.approved })); } catch (err) { fail500(res, err); }
};
// PUT /approval/items/:id/bom      { approved: boolean }
export const updateItemBomApproval = async (req, res) => {
  try { respond(res, await setBomApproved({ ...base(req), approved: !!req.body.approved })); } catch (err) { fail500(res, err); }
};
// PUT /approval/items/:id/qc       { approved: boolean }
export const updateItemQcApproval = async (req, res) => {
  try { respond(res, await setQcListApproved({ ...base(req), approved: !!req.body.approved })); } catch (err) { fail500(res, err); }
};
// PUT /approval/items/:id/release  { status: Released|Not Released }
export const updateItemReleaseStatus = async (req, res) => {
  try { respond(res, await setReleaseStatus({ ...base(req), status: req.body.status })); } catch (err) { fail500(res, err); }
};
