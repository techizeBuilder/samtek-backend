// Feature 26 (24 Nov 2026): the Super Admin Dashboard / Orders / Sales / Customers, per company.
// docs/client-features-2026-11/26-super-admin-logic.md. Replaces the handlers of the same names in
// superAdminController.js for these routes. The Super Admin role is checked by the router guard.
import User from '../models/User.js';
import Order from '../models/Order.js';
import Customer from '../models/Customer.js';
import Lead from '../models/Lead.js';
import {
  SaError, VALUE_STATUSES, OPEN_STATUSES, ORDER_STATUSES, SALES_ROLES, wonExpr,
  oid, esc, pageOf, companyOf, pickerCompanies, companyRows, orderGroup,
} from '../services/superAdmin/superAdminStats.js';

const handle = (fn) => async (req, res) => {
  try { res.json({ success: true, data: await fn(req) }); } catch (err) {
    if (err instanceof SaError) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[super-admin]', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
const cMatch = (c) => (c ? { companyId: { $in: [c._id, String(c._id)] } } : {});
const companyName = (c) => (c ? { _id: c._id, name: c.name || c.unitName, city: c.city || '' } : null);

// ── Dashboard ──
export const getPickerCompanies = handle(() => pickerCompanies());

export const getDashboard = handle(async (req) => {
  const company = await companyOf(req.query);
  if (!company) {
    const { rows, total } = await companyRows();
    return { scope: 'all', companies: rows, total, valueStatuses: VALUE_STATUSES };
  }
  const m = cMatch(company);
  const [{ rows }, recentOrders, recentCustomers, recentLeads] = await Promise.all([
    companyRows([company._id]),
    Order.find(m).select('orderCode totalAmount status createdAt customer salesPerson').populate('customer', 'name').populate('salesPerson', 'fullName username').sort({ createdAt: -1 }).limit(10).lean(),
    Customer.find(m).select('name contactPerson mobile city active createdAt').sort({ createdAt: -1 }).limit(10).lean(),
    Lead.find(m).select('leadCode companyName contactPerson status stage createdAt assignedTo').populate('assignedTo', 'fullName username').sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  return { scope: 'company', company: companyName(company), numbers: rows[0] || null, recentOrders, recentCustomers, recentLeads, valueStatuses: VALUE_STATUSES };
});

// ── Orders ──
export const getOrders = handle(async (req) => {
  const q = req.query;
  const company = await companyOf(q);
  const { page, limit, skip } = pageOf(q);
  const query = { ...cMatch(company) };
  if (q.status && q.status !== 'all') {
    if (!ORDER_STATUSES.includes(q.status)) throw new SaError(400, 'Unknown status.');
    query.status = q.status;
  }
  const s = String(q.search || '').trim();
  if (s) {
    const rx = new RegExp(esc(s), 'i');
    const customers = await Customer.find({ ...cMatch(company), name: rx }).select('_id').limit(200).lean();
    query.$or = [{ orderCode: rx }, { orderNumber: rx }, ...(customers.length ? [{ customer: { $in: customers.map((c) => c._id) } }] : [])];
  }
  if (q.from || q.to) {
    query.createdAt = {};
    if (q.from) query.createdAt.$gte = new Date(`${q.from}T00:00:00+05:30`);
    if (q.to) query.createdAt.$lte = new Date(`${q.to}T23:59:59.999+05:30`);
  }
  const [orders, total, sum] = await Promise.all([
    Order.find(query).select('orderCode orderNumber totalAmount status createdAt customer salesPerson companyId')
      .populate('customer', 'name contactPerson mobile').populate('salesPerson', 'fullName username').populate('companyId', 'name unitName city')
      .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(query),
    Order.aggregate([{ $match: query }, orderGroup(null)]),
  ]);
  return {
    orders, total, page, limit, statuses: ORDER_STATUSES,
    summary: { orders: sum[0]?.orders || 0, orderValue: sum[0]?.orderValue || 0, openOrders: sum[0]?.openOrders || 0 },
    company: companyName(company),
  };
});

export const getOrderById = handle(async (req) => {
  const { id } = req.params;
  const order = /^[a-f0-9]{24}$/i.test(id) ? await Order.findById(id)
    .populate('customer', 'name contactPerson email mobile address city')
    .populate('salesPerson', 'username fullName email')
    .populate('companyId', 'name unitName city')
    .populate('products.product', 'name code category price').lean() : null;
  if (!order) throw new SaError(404, 'Order not found.');
  return order;
});

// ── Sales ──
const SORTS = { orderValue: (a, b) => b.orderValue - a.orderValue, orders: (a, b) => b.orders - a.orders, leads: (a, b) => b.leads - a.leads, name: (a, b) => a.name.localeCompare(b.name) };

export const getSales = handle(async (req) => {
  const q = req.query;
  const company = await companyOf(q);
  const { page, limit, skip } = pageOf(q);
  const query = { role: { $in: SALES_ROLES }, ...cMatch(company) };
  const s = String(q.search || '').trim();
  if (s) { const rx = new RegExp(esc(s), 'i'); query.$or = [{ fullName: rx }, { username: rx }, { email: rx }]; }
  const people = await User.find(query).select('fullName username email role isActive companyId').populate('companyId', 'name unitName city').lean();
  const ids = people.map((p) => p._id);
  const [orders, leads] = ids.length ? await Promise.all([
    Order.aggregate([{ $match: { salesPerson: { $in: ids } } }, orderGroup('$salesPerson')]),
    Lead.aggregate([{ $match: { assignedTo: { $in: ids } } }, { $group: { _id: '$assignedTo', n: { $sum: 1 }, won: { $sum: wonExpr } } }]),
  ]) : [[], []];
  const O = new Map(orders.map((r) => [String(r._id), r])), L = new Map(leads.map((r) => [String(r._id), r]));
  const rows = people.map((p) => {
    const o = O.get(String(p._id)) || {}, l = L.get(String(p._id)) || {};
    return {
      _id: p._id, name: p.fullName || p.username, email: p.email || '', role: p.role, isActive: p.isActive !== false,
      company: p.companyId ? { _id: p.companyId._id, name: p.companyId.name || p.companyId.unitName } : null,
      orders: o.orders || 0, orderValue: o.orderValue || 0, openOrders: o.openOrders || 0, lastOrder: o.lastOrder || null,
      leads: l.n || 0, dealWon: l.won || 0,
    };
  }).sort(SORTS[q.sort] || SORTS.orderValue);
  const sum = (k) => rows.reduce((t, r) => t + (r[k] || 0), 0);
  return {
    people: rows.slice(skip, skip + limit), total: rows.length, page, limit, company: companyName(company),
    summary: { people: rows.length, orders: sum('orders'), orderValue: sum('orderValue'), leads: sum('leads'), dealWon: sum('dealWon') },
  };
});

export const getSalesPerson = handle(async (req) => {
  const { salesPersonId } = req.params;
  if (!/^[a-f0-9]{24}$/i.test(salesPersonId)) throw new SaError(404, 'Sales person not found.');
  const p = await User.findById(salesPersonId).select('fullName username email role isActive companyId createdAt').populate('companyId', 'name unitName city').lean();
  if (!p || !SALES_ROLES.includes(p.role)) throw new SaError(404, 'Sales person not found.');
  const { page, limit, skip } = pageOf(req.query, 50);
  const m = { salesPerson: p._id };
  const [orders, total, sum, leads] = await Promise.all([
    Order.find(m).select('orderCode totalAmount status createdAt customer companyId').populate('customer', 'name contactPerson mobile').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(m),
    Order.aggregate([{ $match: m }, orderGroup(null)]),
    Lead.aggregate([{ $match: { assignedTo: p._id } }, { $group: { _id: null, n: { $sum: 1 }, won: { $sum: wonExpr } } }]),
  ]);
  return {
    person: { _id: p._id, name: p.fullName || p.username, email: p.email || '', role: p.role, isActive: p.isActive !== false, company: p.companyId ? { _id: p.companyId._id, name: p.companyId.name || p.companyId.unitName } : null },
    numbers: { orders: sum[0]?.orders || 0, orderValue: sum[0]?.orderValue || 0, openOrders: sum[0]?.openOrders || 0, lastOrder: sum[0]?.lastOrder || null, leads: leads[0]?.n || 0, dealWon: leads[0]?.won || 0 },
    orders, total, page, limit,
  };
});

// ── Customers ──
export const getCustomers = handle(async (req) => {
  const q = req.query;
  const company = await companyOf(q);
  const { page, limit, skip } = pageOf(q);
  const query = { ...cMatch(company) };
  const s = String(q.search || '').trim();
  if (s) { const rx = new RegExp(esc(s), 'i'); query.$or = [{ name: rx }, { contactPerson: rx }, { email: rx }, { mobile: rx }, { city: rx }]; }
  if (q.status === 'active') query.active = 'Yes';
  else if (q.status === 'inactive') query.active = 'No';
  const [customers, total, counts] = await Promise.all([
    Customer.find(query).select('name contactPerson email mobile city active createdAt companyId').populate('companyId', 'name unitName city').sort({ name: 1 }).skip(skip).limit(limit).lean(),
    Customer.countDocuments(query),
    Customer.aggregate([{ $match: query }, { $group: { _id: null, n: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$active', 'Yes'] }, 1, 0] } } } }]),
  ]);
  const stats = customers.length ? await Order.aggregate([{ $match: { customer: { $in: customers.map((c) => c._id) } } }, orderGroup('$customer')]) : [];
  const S = new Map(stats.map((r) => [String(r._id), r]));
  return {
    customers: customers.map((c) => {
      const o = S.get(String(c._id)) || {};
      return { ...c, company: c.companyId ? { _id: c.companyId._id, name: c.companyId.name || c.companyId.unitName } : null, companyId: undefined,
        orders: o.orders || 0, orderValue: o.orderValue || 0, lastOrder: o.lastOrder || null };
    }),
    total, page, limit, company: companyName(company),
    summary: { customers: counts[0]?.n || 0, active: counts[0]?.active || 0 },
  };
});

export const getCustomerById = handle(async (req) => {
  const { id } = req.params;
  const customer = /^[a-f0-9]{24}$/i.test(id) ? await Customer.findById(id).populate('companyId', 'name unitName city').lean() : null;
  if (!customer) throw new SaError(404, 'Customer not found.');
  const [recentOrders, sum] = await Promise.all([
    Order.find({ customer: customer._id }).select('orderCode totalAmount status createdAt salesPerson').populate('salesPerson', 'username fullName').sort({ createdAt: -1 }).limit(50).lean(),
    Order.aggregate([{ $match: { customer: customer._id } }, orderGroup(null)]),
  ]);
  return { customer, recentOrders, numbers: { orders: sum[0]?.orders || 0, orderValue: sum[0]?.orderValue || 0, openOrders: sum[0]?.openOrders || 0, lastOrder: sum[0]?.lastOrder || null } };
});

export { OPEN_STATUSES };
