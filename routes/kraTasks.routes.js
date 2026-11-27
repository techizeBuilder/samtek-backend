// Feature 25, slice 2 (client, 23 Nov 2026): the new Task Management on KRAs.
// docs/client-features-2026-11/25-kra-tasks-logic.md. Who may do what is checked in the service.
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateToken } from '../middleware/auth.js';
import {
  TaskError, givablePeople, getSettings, saveSettings, createTasks, listTasks, getTask, startTask, toggleStep,
  submitTask, reviewTask, changeDue, editTask, cancelTask, commentTask, legacyTasks,
  writeUpdate, raiseBlocker, clearBlocker, tickRoutine, sendBackRoutine, todayFor,
} from '../services/kraTasks/kraTaskService.js';
import { taskReport, personReport } from '../services/kraTasks/kraReportService.js';
// Feature 33 (25 Nov 2026): the Task Management switch (view / add / edit / delete); own tasks stay open.
import { requireTaskAccess } from '../services/kraTasks/taskAccess.js';
const notMine = (req) => (req.query?.scope || 'mine') !== 'mine';

const router = Router();
const DIR = 'uploads/kra-tasks/';
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true }); cb(null, DIR); },
    filename(req, file, cb) { cb(null, `task-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname || '').toLowerCase()}`); },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) { if (ALLOWED.includes(file.mimetype)) return cb(null, true); cb(new Error('Attach a photo, PDF, Word or Excel file.')); },
}).single('file');
// Multipart: the file under "file", the rest as JSON under "payload" (plain JSON works too).
// Whatever a refused request wrote is deleted again.
const withFile = (req, res, next) => upload(req, res, (err) => {
  const drop = () => req.file && fs.unlink(req.file.path, () => {});
  if (err) { drop(); return res.status(400).json({ success: false, message: err.code === 'LIMIT_FILE_SIZE' ? 'The file can be up to 10 MB.' : err.message }); }
  if (typeof req.body?.payload === 'string') { try { req.body = JSON.parse(req.body.payload); } catch { drop(); return res.status(400).json({ success: false, message: 'The request could not be read.' }); } }
  req.taskFile = req.file ? { file: `/uploads/kra-tasks/${req.file.filename}`, name: req.file.originalname } : null;
  if (req.file) res.on('finish', () => { if (res.statusCode >= 400) drop(); });
  next();
});
const handle = (fn) => async (req, res) => {
  try {
    if (!req.user?.companyId) return res.status(400).json({ success: false, message: 'No company on this login.' });
    res.json({ success: true, data: await fn(req) });
  } catch (err) {
    if (err instanceof TaskError) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[kra-tasks]', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

router.use(authenticateToken);
router.get('/people', requireTaskAccess('add'), handle((req) => givablePeople(req.user, req.query)));
router.get('/settings', handle((req) => getSettings(req.user.companyId)));
router.put('/settings', handle((req) => saveSettings(req.user, req.body || {})));
router.get('/today', handle((req) => todayFor(req.user))); // slice 3: My tasks → Today
// Slice 4: reports (heads: their department; HR and the top admins: everyone).
router.get('/report', requireTaskAccess('view'), handle((req) => taskReport(req.user, req.query)));
router.get('/report/person/:id', requireTaskAccess('view'), handle((req) => personReport(req.user, req.params.id, req.query)));
router.get('/legacy', requireTaskAccess('view'), handle((req) => legacyTasks(req.user, req.query)));
router.get('/', requireTaskAccess('view', notMine), handle((req) => listTasks(req.user, req.query)));
router.post('/', requireTaskAccess('add'), withFile, handle((req) => createTasks(req.user, req.body || {}, req.taskFile)));
router.get('/:id', handle((req) => getTask(req.user, req.params.id)));
router.put('/:id', requireTaskAccess('edit'), handle((req) => editTask(req.user, req.params.id, req.body || {})));
router.post('/:id/start', handle((req) => startTask(req.user, req.params.id)));
router.post('/:id/steps/:stepId', handle((req) => toggleStep(req.user, req.params.id, req.params.stepId, req.body?.done !== false)));
router.post('/:id/submit', withFile, handle((req) => submitTask(req.user, req.params.id, req.body || {}, req.taskFile)));
router.post('/:id/review', requireTaskAccess('edit'), handle((req) => reviewTask(req.user, req.params.id, req.body || {})));
router.post('/:id/due', requireTaskAccess('edit'), handle((req) => changeDue(req.user, req.params.id, req.body || {})));
router.post('/:id/cancel', requireTaskAccess('delete'), handle((req) => cancelTask(req.user, req.params.id, req.body || {})));
router.post('/:id/comment', handle((req) => commentTask(req.user, req.params.id, req.body || {})));
// Slice 3: daily updates, blockers, routine items.
router.post('/:id/update', handle((req) => writeUpdate(req.user, req.params.id, req.body || {})));
router.post('/:id/blocker', handle((req) => raiseBlocker(req.user, req.params.id, req.body || {})));
router.post('/:id/unblock', handle((req) => clearBlocker(req.user, req.params.id, req.body || {})));
router.post('/:id/tick', withFile, handle((req) => tickRoutine(req.user, req.params.id, req.taskFile)));
router.post('/:id/send-back', requireTaskAccess('edit'), handle((req) => sendBackRoutine(req.user, req.params.id, req.body || {})));

export default router;
