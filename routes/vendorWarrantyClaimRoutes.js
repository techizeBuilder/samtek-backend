import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { claimEvidenceUpload } from '../middleware/claimEvidenceUpload.js';
import { getClaims, getClaim, lookupClaimSerial, getClaimVendors, getClaimItems, postClaim, putClaim } from '../controllers/vendorWarrantyClaimController.js';

// Vendor warranty claims (2026-10-13) — Complaints → Support Management, plus
// the Company Admin (checkPermission alone doesn't let that role through —
// same as the price history routes).
const router = express.Router();
router.use(authenticateToken);

const ADMIN_ROLES = ['Company Admin', 'Super Admin', 'Superadmin'];
const support = (action) => {
  const check = checkPermission('complaints', 'supportManagement', action);
  return (req, res, next) => (ADMIN_ROLES.includes(req.user?.role) ? next() : check(req, res, next));
};

router.get('/', support('view'), getClaims);
router.get('/lookup', support('view'), lookupClaimSerial);
router.get('/vendors', support('view'), getClaimVendors);
router.get('/items', support('view'), getClaimItems);
router.get('/:id', support('view'), getClaim);
router.post('/', support('add'), claimEvidenceUpload, postClaim);
router.put('/:id', support('edit'), claimEvidenceUpload, putClaim);

export default router;
