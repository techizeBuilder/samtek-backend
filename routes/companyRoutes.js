import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {
  getCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  deleteCompany,
  getCompanyStats,
  getCompaniesDropdown,
  getCompaniesSimple
} from '../controllers/companyController.js';
import { authenticateToken as authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// Multer setup for company stamp uploads
const stampStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/company-stamps';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `stamp_${req.params.id}_${Date.now()}${ext}`);
  }
});
const stampUpload = multer({
  storage: stampStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP images are allowed for stamp'));
  }
});

// Public routes (no authentication required)
router.get('/simple', getCompaniesSimple);

// Apply authentication middleware to protected routes
router.use(authenticateUser);

// Company stamp upload route
router.put('/:id/stamp', stampUpload.single('stamp'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No stamp image uploaded' });
    }
    const { Company } = await import('../models/Company.js');
    const stampUrl = `/uploads/company-stamps/${req.file.filename}`;
    const company = await Company.findByIdAndUpdate(
      req.params.id,
      { stampUrl },
      { new: true }
    );
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
    res.json({ success: true, message: 'Stamp uploaded successfully', stampUrl, company });
  } catch (err) {
    console.error('Stamp upload error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Cash Password — 6-digit, AES-encrypted (reversible so the Company Admin can
// view it back), one per company. Required first factor before Accounts can
// view a customer's Cash Amount (see cashAccessController.js). Only that
// company's own Company Admin (or Superadmin) may set/view it.
const assertCashPasswordAccess = (req, res) => {
  const isSuperadmin = req.user.role === 'Superadmin' || req.user.role === 'Super Admin';
  if (!isSuperadmin && req.user.companyId?.toString() !== req.params.id) {
    res.status(403).json({ success: false, message: 'Access denied.' });
    return false;
  }
  if (!isSuperadmin && req.user.role !== 'Company Admin') {
    res.status(403).json({ success: false, message: 'Only the Company Admin can manage the Cash Password.' });
    return false;
  }
  return true;
};

router.put('/:id/cash-password', async (req, res) => {
  try {
    const { password } = req.body;
    if (!/^\d{6}$/.test(password || '')) {
      return res.status(400).json({ success: false, message: 'Cash Password must be exactly 6 digits.' });
    }
    if (!assertCashPasswordAccess(req, res)) return;

    const { Company } = await import('../models/Company.js');
    const { encryptCashPassword } = await import('../utils/cashCrypto.js');
    const company = await Company.findByIdAndUpdate(
      req.params.id,
      { cashPasswordEnc: encryptCashPassword(password) },
      { new: true }
    );
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
    res.json({ success: true, message: 'Cash Password saved successfully' });
  } catch (err) {
    console.error('Cash Password save error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id/cash-password', async (req, res) => {
  try {
    if (!assertCashPasswordAccess(req, res)) return;

    const { Company } = await import('../models/Company.js');
    const { decryptCashPassword } = await import('../utils/cashCrypto.js');
    const company = await Company.findById(req.params.id).select('+cashPasswordEnc');
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });

    const password = decryptCashPassword(company.cashPasswordEnc);
    res.json({ success: true, isSet: !!password, password: password || null });
  } catch (err) {
    console.error('Cash Password fetch error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Company routes
router.get('/dropdown', getCompaniesDropdown);
router.get('/stats', getCompanyStats);
router.get('/', getCompanies);
router.get('/:id', getCompanyById);
router.post('/', createCompany);
router.put('/:id', updateCompany);
router.delete('/:id', deleteCompany);

export default router;