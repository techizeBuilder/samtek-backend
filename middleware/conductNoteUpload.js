// Feature 13 (2026-11-17): one optional photo or document on a conduct note.
// Notes are about people, so the file is NOT served from the public /uploads
// route (index.js blocks /uploads/conduct-notes); it's opened only through the
// API, by someone allowed to see the note.
import multer from 'multer';
import path from 'path';
import fs from 'fs';

export const CONDUCT_FILE_MAX_MB = 10;
export const CONDUCT_DIR = 'uploads/conduct-notes/';
const ALLOWED = { 'image/jpeg': true, 'image/jpg': true, 'image/png': true, 'image/webp': true, 'application/pdf': true };

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      if (!fs.existsSync(CONDUCT_DIR)) fs.mkdirSync(CONDUCT_DIR, { recursive: true });
      cb(null, CONDUCT_DIR);
    },
    filename(req, file, cb) {
      cb(null, `conduct-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: CONDUCT_FILE_MAX_MB * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (ALLOWED[file.mimetype]) return cb(null, true);
    cb(new Error('Attach a photo (JPG, PNG, WEBP) or a PDF.'));
  },
});

const discard = (req) => (req.file ? fs.promises.unlink(req.file.path).catch(() => {}) : Promise.resolve());

// The note comes as multipart (file under "attachment", the rest as JSON under
// "payload") or as plain JSON. Sets req.conductAttachment = { file, name } | null.
// A refused note (4xx) deletes the file again.
export function conductNoteUpload(req, res, next) {
  upload.single('attachment')(req, res, async (err) => {
    if (err) {
      await discard(req);
      const message = err.code === 'LIMIT_FILE_SIZE' ? `The file can be up to ${CONDUCT_FILE_MAX_MB} MB.`
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Attach one file only.' : err.message;
      return res.status(400).json({ success: false, message });
    }
    if (typeof req.body?.payload === 'string') {
      try { req.body = JSON.parse(req.body.payload); } catch {
        await discard(req);
        return res.status(400).json({ success: false, message: 'The note could not be read.' });
      }
    }
    // mime: feature 24 checks a Safety note's file is a photo (not stored).
    req.conductAttachment = req.file ? { file: req.file.filename, name: req.file.originalname, mime: req.file.mimetype } : null;
    if (req.file) res.on('finish', () => { if (res.statusCode >= 400 && res.statusCode < 500) discard(req); });
    next();
  });
}

/** Sends a note's file (after the caller has checked the person may see the note). */
export function sendConductFile(res, attachment) {
  const file = attachment?.file && path.basename(attachment.file);
  const full = file ? path.join(process.cwd(), CONDUCT_DIR, file) : null;
  if (!full || !fs.existsSync(full)) return res.status(404).json({ success: false, message: 'File not found' });
  res.setHeader('Content-Disposition', `inline; filename="${String(attachment.name || file).replace(/"/g, '')}"`);
  return res.sendFile(full);
}
