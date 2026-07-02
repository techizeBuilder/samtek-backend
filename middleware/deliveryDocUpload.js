import multer from 'multer';
import path from 'path';
import fs from 'fs';

const ALLOWED_MIMES = {
  'application/pdf': true,
  'image/jpeg': true,
  'image/png': true,
  'image/jpg': true,
  'image/webp': true,
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = 'uploads/delivery-docs/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename(req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const prefix = file.fieldname.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    cb(null, `${prefix}-${unique}${path.extname(file.originalname)}`);
  },
});

export const deliveryDocUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter(req, file, cb) {
    if (ALLOWED_MIMES[file.mimetype]) {
      return cb(null, true);
    }
    cb(new Error('Unsupported file type. Allowed: PDF, JPG, JPEG, PNG, WEBP'));
  },
});

// Middleware: accepts noc, ewayBill, invoice — all required
export const deliveryDocsMiddleware = deliveryDocUpload.fields([
  { name: 'noc', maxCount: 1 },
  { name: 'ewayBill', maxCount: 1 },
  { name: 'invoice', maxCount: 1 },
]);
