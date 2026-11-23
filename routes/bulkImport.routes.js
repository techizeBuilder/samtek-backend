// Feature 20 (client, 21 Nov 2026): R&D's bulk import — template, check, import.
// docs/client-features-2026-11/20-bulk-import-logic.md
// R&D only (rnd → inventory → add, the same gate as Fabrication Master's add). The import
// call sends the same file again, so nothing is kept on the server between the two.
import { Router } from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { ImportError } from '../services/bulkImport/common.js';
import * as inventoryImport from '../services/bulkImport/inventoryImport.js';
import * as fabricationImport from '../services/bulkImport/fabricationImport.js';
import * as productMasterImport from '../services/bulkImport/productMasterImport.js'; // feature 21
import * as motorImport from '../services/bulkImport/motorImport.js'; // feature 22
import * as plantImport from '../services/bulkImport/plantImport.js'; // feature 22

const router = Router();
router.use(authenticateToken);
const rndAdd = checkPermission('rnd', 'inventory', 'add');
// Feature 21: Product Master's own add permission (the same gate as its master-options and template saves).
const productMasterAdd = checkPermission('rnd', 'productMaster', 'add');
// Feature 22: each page's own add permission.
const motorMasterAdd = checkPermission('rnd', 'motorMaster', 'add');
const plantMasterAdd = checkPermission('rnd', 'plantMaster', 'add');

const XLSX_TYPES = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/octet-stream'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (XLSX_TYPES.includes(file.mimetype) || /\.xlsx?$/i.test(file.originalname || '')
    ? cb(null, true)
    : cb(new ImportError(400, 'Upload the Excel template (.xlsx).'))),
});
// multer's own errors (file too large …) as a plain 400.
const fileOnly = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (!err) return next();
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'The file is over 5 MB: split it into smaller files.' : err.message;
  return res.status(400).json({ success: false, message });
});

const fail = (res, err) => {
  if (err instanceof ImportError) return res.status(err.status).json({ success: false, message: err.message, problems: err.problems || [] });
  console.error('[bulk-import]', err);
  return res.status(500).json({ success: false, message: err.message });
};
const needFile = (req) => {
  if (!req.file?.buffer?.length) throw new ImportError(400, 'Choose the filled-in template to upload.');
  if (!req.user?.companyId) throw new ImportError(400, 'No company on this login.');
  return req.file.buffer;
};

/** The three routes for one import kind. */
function mount(kind, svc, filename, gate = rndAdd) {
  router.get(`/${kind}/template`, gate, async (req, res) => {
    try {
      const buf = await svc.buildTemplate(req.user.companyId);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (err) { fail(res, err); }
  });
  router.post(`/${kind}/check`, gate, fileOnly, async (req, res) => {
    try {
      const c = await svc.check(req.user.companyId, needFile(req));
      res.json({ success: true, ok: c.problems.length === 0, total: c.total, problems: c.problems, preview: c.preview, counts: c.counts, newValues: c.newValues || [], fromMaster: c.fromMaster || [] });
    } catch (err) { fail(res, err); }
  });
  router.post(`/${kind}/import`, gate, fileOnly, async (req, res) => {
    try {
      res.json({ success: true, ...(await svc.importFile(req.user.companyId, req.user, needFile(req))) });
    } catch (err) { fail(res, err); }
  });
}

mount('inventory', inventoryImport, 'rd-inventory-import-template.xlsx');
mount('fabrication', fabricationImport, 'fabrication-master-import-template.xlsx');
mount('product-master', productMasterImport, 'product-master-import-template.xlsx', productMasterAdd);
mount('motor-master', motorImport, 'motor-master-import-template.xlsx', motorMasterAdd);
mount('plant-master', plantImport, 'plant-master-import-template.xlsx', plantMasterAdd);

export default router;
