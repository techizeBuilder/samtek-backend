import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Multer storage for warranty card uploads (images + PDF)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = 'uploads/warranty-cards/';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'warranty-' + uniqueSuffix + path.extname(file.originalname));
  }
});

export const warrantyUpload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB
  },
  fileFilter: function (req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, WebP images and PDF files are allowed for warranty card.'), false);
    }
  }
});
