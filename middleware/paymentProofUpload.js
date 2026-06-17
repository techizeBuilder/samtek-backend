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
    const dir = 'uploads/payment-proofs/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename(req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'payment-proof-' + unique + path.extname(file.originalname));
  },
});

export const paymentProofUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
  fileFilter(req, file, cb) {
    if (ALLOWED_MIMES[file.mimetype]) {
      return cb(null, true);
    }
    cb(new Error('Unsupported file type. Allowed: PDF, JPG, JPEG, PNG, WEBP'));
  },
});
