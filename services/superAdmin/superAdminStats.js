// Feature 26 (24 Nov 2026): Super Admin pages per company — the shared rules and the grouped
// numbers. docs/client-features-2026-11/26-super-admin-logic.md
// Every number is a grouped query bounded by the company / the ids on the page; never one
// query per row.
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Order from '../../models/Order.js';
import Customer from '../../models/Customer.js';
import Lead from '../../models/Lead.js';
import { Company } from '../../models/Company.js';

export class SaError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const SA_ROLES = ['Super Admin', 'Superadmin'];
export const isSuperAdmin = (user) => SA_ROLES.includes(user?.role);
// Decision 3: order value = approved and later only.
export const VALUE_STATUSES = ['approved', 'in_production', 'completed'];
export const OPEN_STATUSES = ['pending', 'pending_service_approval', 'approved', 'in_production'];
export const ORDER_STATUSES = Order.schema.path('status')?.enumValues || ['pending', 'pending_service_approval', 'rejected_by_service', 'approved', 'rejected', 'in_production', 'completed', 'cancelled'];
export const SALES_ROLES = ['Sales Head', 'Sales Employee', 'Sales'];
// A won lead: status "Won" (markLeadAsWon), or the stage "Deal Won" (24 Nov: dev has 108 with status Won).
export const DEAL_WON = 'Deal Won';
export const wonExpr = { $cond: [{ $or: [{ $eq: ['$status', 'Won'] }, { $eq: ['$stage', DEAL_WON] }] }, 1, 0] };

export const oid = (v) => new mongoose.Types.ObjectId(String(v));
export const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const pageOf = (q, max = 100) => {
  const limit = Math.min(max, Math.max(1, parseInt(q.limit, 10) || 20));
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  return { page, limit, skip: (page - 1) * limit };
};

/** `?company=` → the company (lean) or null for "all companies"; a bad id → 400. */
export async function companyOf(q) {
  const id = String(q.company || '').trim();
  if (!id || id === 'all') return null;
  if (!mongoose.isValidObjectId(id)) throw new SaError(400, 'Unknown company.');
  const c = await Company.findById(id).select('name unitName city isActive').lean();
  if (!c) throw new SaError(400, 'Unknown company.');
  return c;
}

/** Every company for the picker (all of them, inactive ones marked). */
export async function pickerCompanies() {
  const rows = await Company.find({}).select('name unitName city isActive').sort({ name: 1 }).lean();
  return rows.map((c) => ({ _id: c._id, name: c.name || c.unitName || 'Company', city: c.city || '', isActive: c.isActive !== false }));
}

const valueExpr = { $cond: [{ $in: ['$status', VALUE_STATUSES] }, { $ifNull: ['$totalAmount', 0] }, 0] };
const openExpr = { $cond: [{ $in: ['$status', OPEN_STATUSES] }, 1, 0] };
/** The order numbers of a group: { _id, orders, orderValue, openOrders, lastOrder }. */
export const orderGroup = (by) => ({ $group: { _id: by, orders: { $sum: 1 }, orderValue: { $sum: valueExpr }, openOrders: { $sum: openExpr }, lastOrder: { $max: '$createdAt' } } });

/**
 * One row per company (all, or the ids given) + a total: orders, order value, open orders,
 * customers, leads, Deal Won, users. 4 grouped queries.
 */
export async function companyRows(companyIds = null) {
  const companies = companyIds
    ? await Company.find({ _id: { $in: companyIds } }).select('name unitName city isActive').lean()
    : await Company.find({}).select('name unitName city isActive').sort({ name: 1 }).lean();
  const ids = companies.map((c) => c._id);
  const both = [...ids, ...ids.map(String)];
  const m = { companyId: { $in: both } };
  const [orders, customers, leads, users] = await Promise.all([
    Order.aggregate([{ $match: m }, orderGroup('$companyId')]),
    Customer.aggregate([{ $match: m }, { $group: { _id: '$companyId', n: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: m }, { $group: { _id: '$companyId', n: { $sum: 1 }, won: { $sum: wonExpr } } }]),
    User.aggregate([{ $match: { ...m, role: { $nin: SA_ROLES } } }, { $group: { _id: '$companyId', n: { $sum: 1 }, active: { $sum: { $cond: [{ $ne: ['$isActive', false] }, 1, 0] } } } }]),
  ]);
  const map = (rows) => new Map(rows.map((r) => [String(r._id), r]));
  const O = map(orders), Cu = map(customers), L = map(leads), U = map(users);
  const rows = companies.map((c) => {
    const k = String(c._id);
    return {
      _id: c._id, name: c.name || c.unitName || 'Company', city: c.city || '', isActive: c.isActive !== false,
      orders: O.get(k)?.orders || 0, orderValue: O.get(k)?.orderValue || 0, openOrders: O.get(k)?.openOrders || 0, lastOrder: O.get(k)?.lastOrder || null,
      customers: Cu.get(k)?.n || 0, leads: L.get(k)?.n || 0, dealWon: L.get(k)?.won || 0, users: U.get(k)?.active || 0,
    };
  });
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const total = { orders: sum('orders'), orderValue: sum('orderValue'), openOrders: sum('openOrders'), customers: sum('customers'), leads: sum('leads'), dealWon: sum('dealWon'), users: sum('users'), companies: rows.length };
  return { rows, total };
}
