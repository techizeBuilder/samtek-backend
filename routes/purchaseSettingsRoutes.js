import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  getSettings, updateApprovalRules, updateTemplates, updateQuoteRules, getLowCoverageItems, updateVendorScoreSettings, updatePurchaserScoreSettings,
} from '../controllers/purchaseSettingsController.js';

// Company-wide purchase settings (procurement-v2, 2026-10-08).
//   approval rules (min vendors, PO threshold) + low-coverage list → Company Admin
//   charge / payment-term label templates → Purchase, gated by the new
//     accounts.purchaseSettings feature permission (granted on Company Admin →
//     Roles & Permissions)
const router = express.Router();
router.use(authenticateToken);

const COMPANY_ADMIN_ROLES = ['Company Admin', 'Super Admin'];
const isCompanyAdmin = (req) => COMPANY_ADMIN_ROLES.includes(req.user?.role);

// Readable by the Company Admin, and by anyone who can view Purchases (the
// RFQ/PO page needs the min-vendor number, threshold and templates).
const purchasesView = checkPermission('accounts', 'purchases', 'view');
const companyAdminOrPurchasesView = (req, res, next) =>
  isCompanyAdmin(req) ? next() : purchasesView(req, res, next);

router.get('/', companyAdminOrPurchasesView, getSettings);
router.put('/approval-rules', authorizeRoles(...COMPANY_ADMIN_ROLES), updateApprovalRules);
router.put('/templates', checkPermission('accounts', 'purchaseSettings', 'edit'), updateTemplates);
// Quote validity (days) + price-rise warning (%) — same Purchase permission.
router.put('/quote-rules', checkPermission('accounts', 'purchaseSettings', 'edit'), updateQuoteRules);
router.get('/low-coverage-items', authorizeRoles(...COMPANY_ADMIN_ROLES), getLowCoverageItems);
// Vendor score weights + the Watchlist line (2026-10-13) — Company Admin.
router.put('/vendor-score', authorizeRoles(...COMPANY_ADMIN_ROLES), updateVendorScoreSettings);
// Purchaser score weights (2026-10-13) — Company Admin.
router.put('/purchaser-score', authorizeRoles(...COMPANY_ADMIN_ROLES), updatePurchaserScoreSettings);

export default router;
