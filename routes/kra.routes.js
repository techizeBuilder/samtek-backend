// Feature 25, slice 1 (client, 23 Nov 2026): KRAs. HR (permission hrms → kra) and the Company
// Admin set them; a department head may view their own people's; everyone sees their own.
// docs/client-features-2026-11/25-kra-tasks-logic.md
import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  KraError, canViewKra, canEditKra, rolesOverview, roleKra, saveRoleKra, personKra, savePersonKra, myKra, versionOf,
} from '../services/kra/kraService.js';

const router = Router();
const handle = (fn) => async (req, res) => {
  try {
    if (!req.user?.companyId) return res.status(400).json({ success: false, message: 'No company on this login.' });
    res.json({ success: true, data: await fn(req) });
  } catch (err) {
    if (err instanceof KraError) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[kra]', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
const view = (req, res, next) => (canViewKra(req.user) ? next() : res.status(403).json({ success: false, message: "You don't have access to KRAs." }));
const edit = (req, res, next) => (canEditKra(req.user) ? next() : res.status(403).json({ success: false, message: "You can't change KRAs." }));

router.use(authenticateToken);
router.get('/my', handle((req) => myKra(req.user)));
router.get('/roles', view, handle((req) => rolesOverview(req.user.companyId)));
router.get('/role/:role', view, handle((req) => roleKra(req.user.companyId, req.params.role, req.query)));
router.put('/role/:role', edit, handle((req) => saveRoleKra(req.user, req.params.role, req.body || {})));
router.get('/person/:id', handle((req) => personKra(req.user, req.params.id))); // HR, the person's head, or the person
router.put('/person/:id', edit, handle((req) => savePersonKra(req.user, req.params.id, req.body || {})));
router.get('/version/:setId', handle((req) => versionOf(req.user, req.params.setId)));

export default router;
