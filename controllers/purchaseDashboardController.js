// Purchase Dashboard (2026-10-13, blueprint §21 — services/purchaseDashboardService.js).
// The server picks the view:
//   Company Admin / Super Admin → admin
//   the Purchase Head           → head (or ?view=mine — heads buy too)
//   anyone else with Purchase   → mine
// Purchase separated from Accounts (2026-11-16): "head" is the Purchase Head tick
// (purchase.purchaseHead), not the Accounts Head role, which may now run finance only.
import { buildDashboard } from '../services/purchaseDashboardService.js';
import { getOrCreateSettings } from './purchaseSettingsController.js';
import { userHasPermission } from '../middleware/permissions.js';

const ADMIN_ROLES = ['Company Admin', 'Super Admin', 'Superadmin'];

// The view this person gets for what they asked — or null when it's above them.
// `who`: the user (older callers pass just a role; then only admins differ).
export function viewFor(who, asked) {
  const role = typeof who === 'string' ? who : who?.role;
  const head = typeof who === 'object' && userHasPermission(who, 'purchase', 'purchaseHead', 'view');
  const allowed = ADMIN_ROLES.includes(role) ? ['admin'] : head ? ['head', 'mine'] : ['mine'];
  if (!asked) return allowed[0];
  return allowed.includes(asked) ? asked : null;
}

// GET /api/purchase-dashboard?view=head|mine|admin&period=month|3m|12m
export const getPurchaseDashboard = async (req, res) => {
  try {
    const view = viewFor(req.user, req.query.view);
    if (!view) return res.status(403).json({ success: false, message: 'That dashboard view needs the Purchase Head permission.' });
    const settings = await getOrCreateSettings(req.user.companyId);
    const data = await buildDashboard({ companyId: req.user.companyId, view, userId: req.user._id, period: req.query.period, settings });
    res.json({ success: true, role: req.user.role, views: viewFor(req.user) === 'head' ? ['head', 'mine'] : [viewFor(req.user)], data });
  } catch (err) {
    console.error('Building the purchase dashboard failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
