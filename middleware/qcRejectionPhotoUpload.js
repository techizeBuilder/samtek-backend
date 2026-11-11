// Photos of rejected material (2026-10-30, client): QC attaches them when it
// rejects (or sends to rework / scrap). They stay on the rejection — the QC
// job, the step attempt, the Purchase rejection (REJ-…) — and go to the vendor
// with the 6 pm QC results email. Served via the /uploads static route.
// docs/qc-rejection-photos-2026-10.md.
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Per decision: up to 5 on each reject line, 15 in all (2026-10-30).
export const QC_PHOTO_MAX_FILES = 15;
export const QC_PHOTO_MAX_MB = 10;

const ALLOWED = { 'image/jpeg': true, 'image/jpg': true, 'image/png': true, 'image/webp': true };
const DIR = 'uploads/qc-rejections/';

const storage = multer.diskStorage({
  destination(req, file, cb) {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
    cb(null, DIR);
  },
  filename(req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'qc-reject-' + unique + path.extname(file.originalname).toLowerCase());
  },
});

const upload = multer({
  storage,
  limits: { fileSize: QC_PHOTO_MAX_MB * 1024 * 1024, files: QC_PHOTO_MAX_FILES },
  fileFilter(req, file, cb) {
    if (ALLOWED[file.mimetype]) return cb(null, true);
    cb(new Error('Photos only: JPG, PNG or WEBP.'));
  },
});

// Deletes whatever multer wrote for THIS request.
export async function discardQcRejectionPhotos(req) {
  const files = Array.isArray(req.files) ? req.files : [];
  await Promise.all(files.map(f => fs.promises.unlink(f.path).catch(() => {})));
}

// A QC decision with photos comes as multipart: the photos under "photos" and
// the decision's JSON under "payload" (a plain JSON request still works).
// Sets req.rejectionPhotos = [{ url, name }]. When the decision is refused
// (any 4xx — nothing was saved), the photos are deleted, so nothing is left
// on disk. A 5xx keeps them: part of a PO line may already point at them.
export function qcRejectionPhotoUpload(req, res, next) {
  upload.array('photos', QC_PHOTO_MAX_FILES)(req, res, async (err) => {
    if (err) {
      await discardQcRejectionPhotos(req);
      const message = err.code === 'LIMIT_FILE_SIZE' ? `Each photo can be up to ${QC_PHOTO_MAX_MB} MB.`
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Attach up to ${QC_PHOTO_MAX_FILES} photos.`
          : err.message;
      return res.status(400).json({ success: false, message });
    }
    if (typeof req.body?.payload === 'string') {
      try { req.body = JSON.parse(req.body.payload); } catch {
        await discardQcRejectionPhotos(req);
        return res.status(400).json({ success: false, message: 'The decision could not be read.' });
      }
    }
    req.rejectionPhotos = (Array.isArray(req.files) ? req.files : []).map(f => ({ url: `/uploads/qc-rejections/${f.filename}`, name: f.originalname }));
    if (req.rejectionPhotos.length) {
      res.on('finish', () => { if (res.statusCode >= 400 && res.statusCode < 500) discardQcRejectionPhotos(req); });
    }
    next();
  });
}
