import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { sendMessage } from '../controllers/whatsappController.js';

const router = express.Router();

router.use(authenticateToken);
router.post('/send', sendMessage);

export default router;
