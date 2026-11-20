// Purchase separated from Accounts (2026-11-16, docs/purchase-separation/01-logic.md).
//
// Purchase is its own module (`purchase`), and the money side of buying (vendor
// bills, payments, ageing, money back) is Accounts' `vendorPayments`. Every gate
// below ALSO accepts the old single key `accounts.purchases`: users the one-time
// migration (services/hrPermissionBackfill.js separatePurchaseOnce) hasn't reached
// yet, and test users, keep working. Roles & Permissions no longer offers that key.
import { checkAnyPermission, userHasPermission } from './permissions.js';

const LEGACY = ['accounts', 'purchases'];
export const PURCHASE = ['purchase', 'purchases'];
export const VENDOR_PAYMENTS = ['accounts', 'vendorPayments'];

export const purchaseGate = (action) => checkAnyPermission([PURCHASE, LEGACY], action);
export const purchaseExpensesGate = (action) => checkAnyPermission([['purchase', 'purchaseExpenses'], LEGACY], action);
export const purchaseSettingsGate = (action) => checkAnyPermission([['purchase', 'purchaseSettings'], ['accounts', 'purchaseSettings']], action);
export const purchaseAuditGate = (action) => checkAnyPermission([['purchase', 'purchaseAuditLog'], ['accounts', 'purchaseAuditLog']], action);
export const vendorPaymentsGate = (action) => checkAnyPermission([VENDOR_PAYMENTS, LEGACY], action);
export const tenderExpensesGate = (action) => checkAnyPermission([['accounts', 'tenderExpenses'], LEGACY], action);
// Look-ups both sides need (the vendor list, a vendor's items, reading a PO).
export const buyOrPayView = checkAnyPermission([PURCHASE, VENDOR_PAYMENTS, LEGACY], 'view');
// Purchase pairs that also let Store's own "Purchase Orders" permission in.
export const purchaseOrStorePairs = [PURCHASE, LEGACY, ['Store', 'purchaseOrders']];

/** The Purchase Head (team view, others' expenses, the approval bell); Company / Super Admin too. */
export const isPurchaseHead = (user) =>
  ['Company Admin', 'Super Admin', 'Superadmin'].includes(user?.role)
  || userHasPermission(user, 'purchase', 'purchaseHead', 'view');

export const holdsPurchase = (user) => userHasPermission(user, ...PURCHASE, 'view') || userHasPermission(user, ...LEGACY, 'view');
