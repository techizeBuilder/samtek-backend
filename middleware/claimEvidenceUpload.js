// Evidence on a vendor warranty claim (2026-10-13): photos / PDFs, up to 5 at
// a time, 10 MB each, saved to uploads/warranty-claims/. Multipart only — a
// JSON update passes straight through. Same rule as receiveUpload: whatever
// this request uploaded is deleted again if it's refused (any 4xx / 5xx).
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const DIR = 'uploads/warranty-claims/';
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
      cb(null, DIR);
    },
    filename(req, file, cb) {
      cb(null, 'claim-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname).toLowerCase());
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter(req, file, cb) {
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Evidence must be a JPG, PNG, WebP image or a PDF.'));
  },
}).array('evidence', 5);

const discard = (files) => (files || []).forEach(f => fs.unlink(f.path, () => {}));

export function claimEvidenceUpload(req, res, next) {
  upload(req, res, (err) => {
    if (err) {
      discard(req.files);
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each file can be up to 10 MB.'
        : (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') ? 'Up to 5 evidence files.' : err.message;
      return res.status(400).json({ success: false, message });
    }
    const files = req.files || [];
    if (files.length) res.on('finish', () => { if (res.statusCode >= 400) discard(files); });
    next();
  });
}
