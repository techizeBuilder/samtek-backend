// Feature 10 (2026-11-13): HR's Manpower Score page and incentives — HR
// permission `manpowerScore` (Roles & Permissions → HRMS).
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  getManpowerScores, getManpowerScorePerson, getIncentives,
  approveIncentiveRequest, rejectIncentiveRequest, giveIncentiveDirect, getIncentiveCap,
} from '../controllers/manpowerScoreController.js';
import {
  getHrConductNotes, postHrConductNote, verifyConductNote, rejectConductNote, cancelConductNote, getHrConductFile,
  getWarningRules, putWarningRules, getHrWarningState,
} from '../controllers/scorecardController.js';
import { conductNoteUpload } from '../middleware/conductNoteUpload.js';

const router = Router();
// The Company Admin always may (18 Nov 2026): their permissions start empty, and with
// one HR person nobody else could verify a note HR wrote. Like the Attendance Device page.
const can = (action) => {
  const byPermission = checkPermission('hrms', 'manpowerScore', action);
  return (req, res, next) => (req.user?.role === 'Company Admin' ? next() : byPermission(req, res, next));
};

router.get('/', authMiddleware, can('view'), getManpowerScores);
router.get('/person/:id', authMiddleware, can('view'), getManpowerScorePerson);
router.get('/incentives', authMiddleware, can('view'), getIncentives);
router.get('/incentives/cap', authMiddleware, can('view'), getIncentiveCap); // feature 15
router.put('/incentives/:id/approve', authMiddleware, can('edit'), approveIncentiveRequest);
router.put('/incentives/:id/reject', authMiddleware, can('edit'), rejectIncentiveRequest);
router.post('/incentives', authMiddleware, can('add'), giveIncentiveDirect);
// Conduct notes (feature 13, 2026-11-17): HR records about anyone, and verifies / rejects / cancels.
router.get('/conduct-notes', authMiddleware, can('view'), getHrConductNotes);
// Feature 24 (2026-11-23): warnings — HR's rules per type, and a person's warnings (the note dialog).
// Registered before /conduct-notes/:id/... so "warnings" isn't read as a note id.
router.get('/conduct-notes/warnings', authMiddleware, can('view'), getHrWarningState);
router.get('/warning-rules', authMiddleware, can('view'), getWarningRules);
router.put('/warning-rules', authMiddleware, can('edit'), putWarningRules);
router.get('/conduct-notes/:id/file', authMiddleware, can('view'), getHrConductFile);
router.post('/conduct-notes', authMiddleware, can('add'), conductNoteUpload, postHrConductNote);
router.put('/conduct-notes/:id/verify', authMiddleware, can('edit'), verifyConductNote);
router.put('/conduct-notes/:id/reject', authMiddleware, can('edit'), rejectConductNote);
router.put('/conduct-notes/:id/cancel', authMiddleware, can('edit'), cancelConductNote);

export default router;
