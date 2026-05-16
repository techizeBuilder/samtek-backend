import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Configure multer for item file uploads (images and brochures)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let uploadPath = 'uploads/items/';
    
    if (file.fieldname === 'brochure') {
      uploadPath = 'uploads/items/brochures/';
    } else if (file.fieldname === 'image') {
      uploadPath = 'uploads/items/images/';
    }

    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const prefix = file.fieldname === 'brochure' ? 'brochure-' : 'product-';
    cb(null, prefix + uniqueSuffix + path.extname(file.originalname));
  }
});

export const itemUpload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    if (file.fieldname === 'image') {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed for product photo!'), false);
      }
    } else if (file.fieldname === 'brochure') {
      if (file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        cb(new Error('Only PDF files are allowed for brochure!'), false);
      }
    } else {
      cb(null, true);
    }
  }
});
