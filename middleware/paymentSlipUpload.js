import multer from 'multer';
import path from 'path';
import fs from 'fs';

const ALLOWED_MIMES = {
    'application/pdf': true,
    'image/jpeg': true,
    'image/jpg': true,
    'image/png': true,
    'image/webp': true,
};

const storage = multer.diskStorage({
    destination(req, file, cb) {
        const dir = 'uploads/payment-slips/';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename(req, file, cb) {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'slip-' + unique + path.extname(file.originalname));
    },
});

// multer writes the file BEFORE the controller checks the request, so a
// refused request must discard it, and a replaced slip must delete the old
// file — otherwise the folder fills with files nothing points at (2026-10-29,
// same pattern as vendorDocumentUpload.js).
const SLIP_DIR = path.resolve('uploads/payment-slips');

// Deletes a stored slip by its public URL ('/uploads/payment-slips/x.pdf').
// Only ever touches files inside uploads/payment-slips/; already gone is fine.
export async function removePaymentSlip(fileUrl) {
    if (!fileUrl) return;
    const abs = path.resolve(String(fileUrl).replace(/^\/+/, ''));
    if (!abs.startsWith(SLIP_DIR + path.sep)) return;
    try {
        await fs.promises.unlink(abs);
    } catch (err) {
        if (err.code !== 'ENOENT') console.error('Could not delete payment slip', abs, err.message);
    }
}

// Discards the file multer just wrote for THIS request.
export async function discardSlipUpload(req) {
    if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
}

export const paymentSlipUpload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter(req, file, cb) {
        if (ALLOWED_MIMES[file.mimetype]) {
            return cb(null, true);
        }
        cb(new Error('Unsupported file type. Allowed: PDF, JPG, JPEG, PNG, WEBP'));
    },
});
