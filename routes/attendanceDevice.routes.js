// HR's Attendance Device page. By role rather than checkPermission, because a
// Company Admin's permissions start empty. The login is Company Admin's alone.
import { Router } from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import {
  getStatus, getUnmatched, linkCode, needCompany, postRedownload, postSync, postTest, putLogin,
} from '../controllers/attendanceDeviceController.js';

const router = Router();
router.use(authenticateToken, authorizeRoles('HR-Admin', 'Hr Admin', 'Company Admin'), needCompany);

const companyAdminOnly = authorizeRoles('Company Admin');

router.get('/status', getStatus);
router.get('/unmatched', getUnmatched);
router.post('/link', linkCode);
router.post('/sync', postSync);
router.post('/redownload', postRedownload);
router.put('/login', companyAdminOnly, putLogin);
router.post('/test', companyAdminOnly, postTest);

export default router;
