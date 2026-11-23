// Feature 19 (client, 20 Nov 2026): standard hours — the Company Admin's approvals.
// docs/client-features-2026-11/19-standard-hours-logic.md.
// Waiting list, decisions, approved list and versions: the Company Admin only (the one
// who is measured doesn't approve the yardstick). A BOM step's status: anyone in the
// company (R&D's editor shows it).
import { Router } from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { waitingList, decide, approvedList, versionsOf, bomStatus, StandardError } from '../services/standards/standardService.js';

const router = Router();
const COMPANY_ADMIN_ROLES = ['Company Admin', 'Super Admin'];
const admin = authorizeRoles(...COMPANY_ADMIN_ROLES);

const handle = (fn) => async (req, res) => {
  try {
    if (!req.user?.companyId) return res.status(400).json({ success: false, message: 'No company on this login.' });
    res.json({ success: true, data: await fn(req) });
  } catch (err) {
    if (err instanceof StandardError) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[standard-hours]', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

router.use(authenticateToken);
router.get('/waiting', admin, handle((req) => waitingList(req.user.companyId)));
router.post('/decide', admin, handle((req) => decide(req.user.companyId, req.user, req.body || {})));
router.get('/approved', admin, handle((req) => approvedList(req.user.companyId, req.query)));
router.get('/versions', admin, handle((req) => versionsOf(req.user.companyId, String(req.query.partCode || ''), String(req.query.stepName || ''))));
router.get('/bom-status', handle((req) => bomStatus(req.user.companyId, String(req.query.partCode || ''))));

export default router;
