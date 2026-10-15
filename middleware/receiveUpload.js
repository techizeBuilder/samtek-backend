// Uploads on Store's receive step (2026-10-12): the warranty card (as before)
// and, new, a scan / photo of the vendor's own tax invoice (optional — client
// Q4: the vendor's invoice number + date are recorded so their GST filing
// can be matched to our PO). Each goes to its own folder. Multipart only —
// a JSON receive (fabrication without a scan) passes straight through.
//
// No orphaned files: whatever this request uploaded is deleted again if the
// receive is refused (any 4xx / 5xx response), and on a multer error.
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const DIRS = { warrantyCard: 'uploads/warranty-cards/', vendorInvoiceFile: 'uploads/vendor-invoices/' };
const PREFIX = { warrantyCard: 'warranty-', vendorInvoiceFile: 'vendor-invoice-' };
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = DIRS[file.fieldname] || DIRS.warrantyCard;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    cb(null, (PREFIX[file.fieldname] || 'upload-') + Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname).toLowerCase());
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error(file.fieldname === 'vendorInvoiceFile'
      ? 'The vendor invoice scan must be a JPG, PNG, WebP image or a PDF.'
      : 'Only JPG, PNG, WebP images and PDF files are allowed for warranty card.'));
  },
  // Warranty cards (2026-10-13): one for the whole receipt, or one per piece
  // of a serialised item — the handler checks which.
}).fields([{ name: 'warrantyCard', maxCount: 500 }, { name: 'vendorInvoiceFile', maxCount: 1 }]);

const uploadedFiles = (req) => Object.values(req.files || {}).flat();
const discard = (files) => files.forEach(f => fs.unlink(f.path, () => {}));

export function receiveUpload(req, res, next) {
  upload(req, res, (err) => {
    if (err) {
      discard(uploadedFiles(req));
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each file can be up to 10 MB.' : err.message;
      return res.status(400).json({ success: false, message });
    }
    // The handlers read the warranty card as req.file (single upload before).
    req.file = req.files?.warrantyCard?.[0];
    req.warrantyCards = req.files?.warrantyCard || [];
    req.vendorInvoiceFile = req.files?.vendorInvoiceFile?.[0] || null;
    const files = uploadedFiles(req);
    if (files.length) res.on('finish', () => { if (res.statusCode >= 400) discard(files); });
    next();
  });
}

export const vendorInvoiceUrl = (file) => (file ? `/uploads/vendor-invoices/${file.filename}` : null);

// The vendor's invoice details from a receive request. Returns { error } or
// { invoice } (null when nothing was given).
export function readVendorInvoice(body, file, now = new Date()) {
  const number = String(body?.vendorInvoiceNo || '').trim();
  const rawDate = String(body?.vendorInvoiceDate || '').trim();
  if (!number && !rawDate && !file) return { invoice: null };
  if (!number) return { error: 'Enter the vendor\'s invoice number (or leave the invoice fields empty).' };
  let date = null;
  if (rawDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDate);
    date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
    if (!date || Number.isNaN(date.getTime())) return { error: 'The vendor invoice date isn\'t valid.' };
    if (date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) return { error: 'The vendor invoice date can\'t be in the future.' };
  }
  return { invoice: { number: number.slice(0, 60), date, fileUrl: vendorInvoiceUrl(file) } };
}
