// Purchase Dashboard (2026-10-13, blueprint §21 — services/purchaseDashboardService.js).
// The server picks the view from the role:
//   Company Admin / Super Admin → admin
//   Accounts Head               → head (or ?view=mine — heads buy too)
//   anyone else with Purchases  → mine
import { buildDashboard } from '../services/purchaseDashboardService.js';
import { getOrCreateSettings } from './purchaseSettingsController.js';

const ADMIN_ROLES = ['Company Admin', 'Super Admin', 'Superadmin'];
const HEAD_ROLES = ['Accounts Head'];

// The view this person gets for what they asked — or null when it's above their role.
export function viewFor(role, asked) {
  const allowed = ADMIN_ROLES.includes(role) ? ['admin'] : HEAD_ROLES.includes(role) ? ['head', 'mine'] : ['mine'];
  if (!asked) return allowed[0];
  return allowed.includes(asked) ? asked : null;
}

// GET /api/purchase-dashboard?view=head|mine|admin&period=month|3m|12m
export const getPurchaseDashboard = async (req, res) => {
  try {
    const view = viewFor(req.user.role, req.query.view);
    if (!view) return res.status(403).json({ success: false, message: 'That dashboard view isn\'t available for your role.' });
    const settings = await getOrCreateSettings(req.user.companyId);
    const data = await buildDashboard({ companyId: req.user.companyId, view, userId: req.user._id, period: req.query.period, settings });
    res.json({ success: true, role: req.user.role, views: viewFor(req.user.role) === 'head' ? ['head', 'mine'] : [viewFor(req.user.role)], data });
  } catch (err) {
    console.error('Building the purchase dashboard failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
