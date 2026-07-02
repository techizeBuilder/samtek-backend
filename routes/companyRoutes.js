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

// Company routes
router.get('/dropdown', getCompaniesDropdown);
router.get('/stats', getCompanyStats);
router.get('/', getCompanies);
router.get('/:id', getCompanyById);
router.post('/', createCompany);
router.put('/:id', updateCompany);
router.delete('/:id', deleteCompany);

export default router;