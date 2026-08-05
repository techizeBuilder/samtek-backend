import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Image-only upload for Marketing > Event Flyer — separate from
// marketingUpload.js (which also allows PDF/DOC/video for the general
// asset library) since an event flyer is always a single poster image.
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = 'uploads/marketing/events/';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'event-' + unique + path.extname(file.originalname));
  },
});

export const eventFlyerUpload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter(req, file, cb) {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image files (JPG, PNG, WEBP) are allowed for the event flyer.'));
  },
});
