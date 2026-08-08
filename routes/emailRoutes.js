import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { emailAttachmentUpload } from '../middleware/emailAttachmentUpload.js';
import { sendGenericEmail } from '../controllers/emailController.js';

const router = express.Router();

router.post('/send', authenticateToken, emailAttachmentUpload.array('attachments', 5), sendGenericEmail);

export default router;
