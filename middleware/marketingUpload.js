import multer from 'multer';
import path from 'path';
import fs from 'fs';

const ALLOWED_MIMES = {
  'application/pdf': 'PDF',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'video/mp4': 'MP4',
  'video/quicktime': 'MOV',
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = 'uploads/marketing/';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'mkt-' + unique + path.extname(file.originalname));
  },
});

export const marketingUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter(req, file, cb) {
    if (ALLOWED_MIMES[file.mimetype]) return cb(null, true);
    cb(new Error('Unsupported file type. Allowed: PDF, DOC, DOCX, JPG, PNG, WEBP, MP4, MOV'));
  },
});

export const getFileType = (mimetype) => ALLOWED_MIMES[mimetype] || 'PDF';
