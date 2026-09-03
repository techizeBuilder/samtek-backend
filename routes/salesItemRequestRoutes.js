import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { itemUpload } from '../middleware/itemUpload.js';
import { createRequest, listRequests, reviewRequest, cancelRequest } from '../controllers/salesItemRequestController.js';

const router = express.Router();

router.use(authenticateToken);

// Company-scoped list — Sales's "requests for this lead" view and R&D's
// approval inbox both use this with different query filters.
router.get('/', listRequests);

router.post('/', authorizeRoles('Sales', 'Sales Employee', 'Sales Head', 'Manager', 'Super Admin'), itemUpload.single('image'), createRequest);

router.put('/:id/review', authorizeRoles('Research & Development Head', 'Research Development Employee', 'Super Admin'), reviewRequest);

// Ownership (must be the original requester, still Pending) enforced inside
// the controller rather than by role.
router.delete('/:id', cancelRequest);

export default router;
