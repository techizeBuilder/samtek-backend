import express from 'express';
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

// Public routes (no authentication required)
router.get('/simple', getCompaniesSimple);

// Apply authentication middleware to protected routes
router.use(authenticateUser);

// Company routes
router.get('/dropdown', getCompaniesDropdown);
router.get('/stats', getCompanyStats);
router.get('/', getCompanies);
router.get('/:id', getCompanyById);
router.post('/', createCompany);
router.put('/:id', updateCompany);
router.delete('/:id', deleteCompany);

export default router;