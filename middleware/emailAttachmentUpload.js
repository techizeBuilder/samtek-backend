import multer from 'multer';
import path from 'path';
import fs from 'fs';

const ALLOWED_MIMES = {
  'application/pdf': true,
  'application/msword': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'application/vnd.ms-excel': true,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
  'image/jpeg': true,
  'image/png': true,
  'image/jpg': true,
  'image/webp': true,
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = 'uploads/email-attachments/';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'email-attach-' + unique + path.extname(file.originalname));
  },
});

export const emailAttachmentUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 5 }, // 20 MB per file, 5 files max
  fileFilter(req, file, cb) {
    if (ALLOWED_MIMES[file.mimetype]) return cb(null, true);
    cb(new Error('Unsupported file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, WEBP'));
  },
});
