// Feature 23 (client, 23 Nov 2026): Production's photos / video at a step's finish, QC's view,
// and the Company Admin's clean-up. docs/client-features-2026-11/23-step-media-logic.md
import { addMedia, removeOwn, unitMedia, adminSummary, adminList, adminDelete, StepMediaError } from '../services/stepMedia/stepMediaService.js';

const unitOf = (req) => { const n = parseInt(req.query.unit ?? req.body?.unit, 10); return Number.isFinite(n) && n >= 1 ? n : 1; };
const stepOf = (req) => { const n = parseInt(req.params.stepIndex, 10); return Number.isFinite(n) && n >= 0 ? n : null; };

const handle = (fn) => async (req, res) => {
  try {
    if (!req.user?.companyId) return res.status(400).json({ success: false, message: 'No company on this login.' });
    res.json({ success: true, data: await fn(req) });
  } catch (err) {
    if (err instanceof StepMediaError) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[step-media]', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
const needStep = (req) => {
  const idx = stepOf(req);
  if (idx == null) throw new StepMediaError(400, 'Invalid step index.');
  return idx;
};

// POST /api/production-mfg/orders/:id/processes/:stepIndex/media?unit=N (multipart "files")
export const addStepMedia = handle((req) => addMedia(req.user, req.params.id, unitOf(req), needStep(req), req.stepMedia || []));
// DELETE /api/production-mfg/orders/:id/processes/:stepIndex/media/:mediaId?unit=N
export const removeStepMedia = handle((req) => removeOwn(req.user, req.params.id, unitOf(req), needStep(req), req.params.mediaId));
// GET /api/step-media/order/:orderRef?unit=N (the order's _id or its number)
export const getUnitMedia = handle((req) => unitMedia(req.user, req.params.orderRef, unitOf(req)));
// The Company Admin's Photos & Videos page.
export const getAdminSummary = handle((req) => adminSummary(req.user.companyId));
export const getAdminList = handle((req) => adminList(req.user.companyId, req.query));
export const postAdminDelete = handle((req) => adminDelete(req.user, req.body || {}));
