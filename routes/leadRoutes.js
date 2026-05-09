import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  createLead,
  getLeads,
  getLeadById,
  updateLead,
  deleteLead,
  checkExistingLead,
  getAssignableUsers
} from '../controllers/leadController.js';

const router = express.Router();

router.use(authenticateToken);

router.post('/', createLead);
router.get('/', getLeads);
router.get('/check', checkExistingLead);
router.get('/users', getAssignableUsers);
router.get('/:id', getLeadById);
router.put('/:id', updateLead);
router.delete('/:id', deleteLead);

export default router;
