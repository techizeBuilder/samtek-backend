import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { 
  getProfile, 
  updateProfile, 
  changePassword, 
  uploadProfilePicture 
} from '../controllers/profileController.js';

const router = express.Router();

// Auth middleware scoped only to /profile routes — NOT globally on all /api/* paths
router.get('/profile', authenticateToken, getProfile);
router.put('/profile', authenticateToken, updateProfile);
router.put('/profile/password', authenticateToken, changePassword);
router.post('/profile/picture', authenticateToken, uploadProfilePicture);

export default router;