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
    const dir = 'uploads/lead-documents/';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'lead-doc-' + unique + path.extname(file.originalname));
  },
});

export const leadDocumentUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
  fileFilter(req, file, cb) {
    if (ALLOWED_MIMES[file.mimetype]) return cb(null, true);
    cb(new Error('Unsupported file type. Allowed: PDF, DOC, DOCX, JPG, PNG, WEBP'));
  },
});
