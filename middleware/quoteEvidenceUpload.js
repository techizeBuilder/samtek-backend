// Evidence files for manual quotations (procurement-v2, 2026-10-09) — the
// vendor's WhatsApp screenshot, PDF quotation, printed email, photo of a
// written quote. Served via the /uploads static route, like vendor documents.
// See models/ManualQuotation.js.
import multer from 'multer';
import path from 'path';
import fs from 'fs';

export const QUOTE_EVIDENCE_MAX_FILES = 5;
export const QUOTE_EVIDENCE_MAX_MB = 10;

const ALLOWED_MIMES = {
  'application/pdf': true,
  'image/jpeg': true,
  'image/jpg': true,
  'image/png': true,
  'image/webp': true,
  'application/msword': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
};

const DIR = 'uploads/quote-evidence/';
const storage = multer.diskStorage({
  destination(req, file, cb) {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
    cb(null, DIR);
  },
  filename(req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'quote-evidence-' + unique + path.extname(file.originalname).toLowerCase());
  },
});

export const quoteEvidenceUpload = multer({
  storage,
  limits: { fileSize: QUOTE_EVIDENCE_MAX_MB * 1024 * 1024, files: QUOTE_EVIDENCE_MAX_FILES },
  fileFilter(req, file, cb) {
    if (ALLOWED_MIMES[file.mimetype]) return cb(null, true);
    cb(new Error('Unsupported file type. Allowed: PDF, JPG, PNG, WEBP, DOC, DOCX'));
  },
});

// multer errors (too big, too many, wrong type) as a clean 400 — and since
// multer may already have written some of the files, they're discarded.
export function quoteEvidenceUploadHandler(req, res, next) {
  quoteEvidenceUpload.array('files', QUOTE_EVIDENCE_MAX_FILES)(req, res, async (err) => {
    if (!err) return next();
    await discardQuoteEvidenceUploads(req);
    const message = err.code === 'LIMIT_FILE_SIZE' ? `Each file can be up to ${QUOTE_EVIDENCE_MAX_MB} MB.`
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Attach up to ${QUOTE_EVIDENCE_MAX_FILES} files.`
        : err.message;
    res.status(400).json({ success: false, message });
  });
}

// ── No orphaned files ─────────────────────────────────────────────────────
// Discards whatever multer wrote for THIS request — call it on every early
// return or error after the upload ran.
export async function discardQuoteEvidenceUploads(req) {
  const files = [req.file, ...(Array.isArray(req.files) ? req.files : [])].filter(Boolean);
  await Promise.all(files.map(f => fs.promises.unlink(f.path).catch(() => {})));
}

export const quoteEvidenceUrl = (file) => `/uploads/quote-evidence/${file.filename}`;
