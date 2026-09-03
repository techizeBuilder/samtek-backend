import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { createRequest, listRequests, reviewRequest, cancelRequest } from '../controllers/leadSettingRequestController.js';

const router = express.Router();

router.use(authenticateToken);

// Company-scoped list — Sales Head's "My Requests" and Company Admin's
// approval inbox both use this with different query filters.
router.get('/', listRequests);

router.post('/', authorizeRoles('Sales Head', 'Manager', 'Super Admin'), createRequest);

router.put('/:id/review', authorizeRoles('Company Admin', 'Super Admin'), reviewRequest);

// Ownership (must be the original requester, still Pending) enforced inside
// the controller rather than by role, since any role that can create a
// request should be able to withdraw their own.
router.delete('/:id', cancelRequest);

export default router;
