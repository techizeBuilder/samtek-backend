// Vendor Master compliance documents (GST certificate, PAN, cancelled cheque,
// ISO, ...) and suspension/blacklist evidence — procurement-v2, 2026-10-08.
// Same limits/types as leadDocumentUpload.js; served via the /uploads static route.
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const ALLOWED_MIMES = {
  'application/pdf': true,
  'application/msword': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'image/jpeg': true,
  'image/png': true,
  'image/jpg': true,
  'image/webp': true,
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = 'uploads/vendor-documents/';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'vendor-doc-' + unique + path.extname(file.originalname));
  },
});

export const vendorDocumentUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
  fileFilter(req, file, cb) {
    if (ALLOWED_MIMES[file.mimetype]) return cb(null, true);
    cb(new Error('Unsupported file type. Allowed: PDF, DOC, DOCX, JPG, PNG, WEBP'));
  },
});

// ── No orphaned files ─────────────────────────────────────────────────────
// multer writes a file to disk BEFORE the controller validates the request,
// so every path that refuses or fails a request must discard what was just
// written, and every path that removes a document/vendor must delete its
// file too — otherwise the folder fills with files nothing points at.
const VENDOR_UPLOAD_DIR = path.resolve('uploads/vendor-documents');

// Deletes a stored file by its public URL ('/uploads/vendor-documents/x.pdf').
// Only ever touches files inside uploads/vendor-documents/. A file that's
// already gone is fine.
export async function removeVendorUpload(fileUrl) {
  if (!fileUrl) return;
  const abs = path.resolve(String(fileUrl).replace(/^\/+/, ''));
  if (!abs.startsWith(VENDOR_UPLOAD_DIR + path.sep)) return;
  try {
    await fs.promises.unlink(abs);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not delete vendor upload', abs, err.message);
  }
}

// Discards whatever multer just wrote for THIS request (req.file / req.files)
// — call it on every early return or error after the upload middleware ran.
export async function discardRequestUploads(req) {
  const files = [req.file, ...(Array.isArray(req.files) ? req.files : [])].filter(Boolean);
  await Promise.all(files.map(f => fs.promises.unlink(f.path).catch(() => {})));
}
