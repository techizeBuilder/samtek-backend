// Feature 23 (client, 23 Nov 2026): Production's photos / video at a step's finish.
// Up to 5 photos (JPG / PNG / WEBP, 10 MB each) and 1 video (MP4 / MOV / WEBM, 100 MB) per
// finish; the service counts what the finish already has. Saved to uploads/step-media/ and
// served by the /uploads static route (which supports byte ranges, so videos play in the page).
// Same rule as qcRejectionPhotoUpload.js: whatever THIS request wrote is deleted again when the
// request is refused (any 4xx), so nothing is left on disk.
import multer from 'multer';
import path from 'path';
import fs from 'fs';

export const STEP_MEDIA = { maxPhotos: 5, maxVideos: 1, photoMB: 10, videoMB: 100 };
const PHOTO_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
export const kindOf = (mime) => (PHOTO_TYPES.includes(mime) ? 'photo' : VIDEO_TYPES.includes(mime) ? 'video' : null);
const DIR = 'uploads/step-media/';

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
      cb(null, DIR);
    },
    filename(req, file, cb) {
      cb(null, `step-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname || '').toLowerCase()}`);
    },
  }),
  limits: { fileSize: STEP_MEDIA.videoMB * 1024 * 1024, files: STEP_MEDIA.maxPhotos + STEP_MEDIA.maxVideos },
  fileFilter(req, file, cb) {
    if (kindOf(file.mimetype)) return cb(null, true);
    cb(new Error(`"${file.originalname}": photos (JPG, PNG, WEBP) or a video (MP4, MOV, WEBM) only.`));
  },
});

export async function discardStepMedia(files) {
  await Promise.all((files || []).map((f) => fs.promises.unlink(f.path).catch(() => {})));
}

// Sets req.stepMedia = [{ kind, url, fileName, mime, size }]. Refused here (400): a wrong type,
// a file over its kind's size, more than 6 files, or more than 5 photos / 1 video in one go.
export function stepMediaUpload(req, res, next) {
  upload.array('files', STEP_MEDIA.maxPhotos + STEP_MEDIA.maxVideos)(req, res, async (err) => {
    const files = Array.isArray(req.files) ? req.files : [];
    const refuse = async (message) => { await discardStepMedia(files); res.status(400).json({ success: false, message }); };
    if (err) {
      return refuse(err.code === 'LIMIT_FILE_SIZE' ? `A video can be up to ${STEP_MEDIA.videoMB} MB.`
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Up to ${STEP_MEDIA.maxPhotos} photos and ${STEP_MEDIA.maxVideos} video at a time.`
          : err.message);
    }
    if (!files.length) return refuse('Choose a photo or a video to attach.');
    const big = files.find((f) => kindOf(f.mimetype) === 'photo' && f.size > STEP_MEDIA.photoMB * 1024 * 1024);
    if (big) return refuse(`"${big.originalname}": a photo can be up to ${STEP_MEDIA.photoMB} MB.`);
    if (files.filter((f) => kindOf(f.mimetype) === 'photo').length > STEP_MEDIA.maxPhotos) return refuse(`Up to ${STEP_MEDIA.maxPhotos} photos per finish.`);
    if (files.filter((f) => kindOf(f.mimetype) === 'video').length > STEP_MEDIA.maxVideos) return refuse(`Up to ${STEP_MEDIA.maxVideos} video per finish.`);
    req.stepMedia = files.map((f) => ({ kind: kindOf(f.mimetype), url: `/uploads/step-media/${f.filename}`, fileName: f.originalname || '', mime: f.mimetype, size: f.size, path: f.path }));
    res.on('finish', () => { if (res.statusCode >= 400 && res.statusCode < 500) discardStepMedia(files); });
    next();
  });
}
