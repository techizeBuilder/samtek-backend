// Store → Reservations (2026-10-09). The material reservation ledger
// (MaterialReservation, services/materialReservationService.js) had no screen
// of its own — Store only saw a note per row on Material Transfers. This lists
// every reserved item (per fabrication SIZE), with what's in stock, what
// orders reserved, what Store already issued to them, what's still to issue,
// and the free stock left — plus the orders behind each, in priority order
// (earliest claim first, the order Store should serve them in).
import mongoose from 'mongoose';
import MaterialReservation from '../models/MaterialReservation.js';
import { Item } from '../models/Inventory.js';
import { remainingOf } from '../services/materialReservationService.js';

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const KIND_LABEL = { Machine: 'Machine', ChildPart: 'Child Part', SubChildPart: 'Sub Child Part' };

// GET /api/inventory/reservations
export const listReservations = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const rows = await MaterialReservation.find({ company: companyId }).sort({ createdAt: 1 }).lean();

    const items = await Item.find({ _id: { $in: [...new Set(rows.map(r => String(r.item)))] } })
      .select('name code unit qty productKind dimensionVariants').lean();
    const itemById = new Map(items.map(i => [String(i._id), i]));

    // Order numbers / kinds / status, from both order models.
    const orderInfo = new Map();
    const PO = mongoose.models.ProductionOrder;
    const JW = mongoose.models.SubChildPartJobWorkOrder;
    const idsOf = (model) => [...new Set(rows.filter(r => r.reservedByOrderModel === model).map(r => String(r.reservedByOrderId)))];
    if (PO) {
      for (const o of await PO.find({ _id: { $in: idsOf('ProductionOrder') } }).select('orderId orderKind machineName status demandSource orderCode').lean()) {
        orderInfo.set(String(o._id), {
          code: o.orderId, kind: KIND_LABEL[o.orderKind] || o.orderKind || 'Production',
          forWhat: o.machineName || '', status: o.status, source: o.demandSource || '', salesOrder: o.orderCode || '',
        });
      }
    }
    if (JW) {
      for (const o of await JW.find({ _id: { $in: idsOf('SubChildPartJobWorkOrder') } }).select('orderId status demandSource subChildPartItem').populate('subChildPartItem', 'name').lean()) {
        orderInfo.set(String(o._id), {
          code: o.orderId, kind: 'Job work', forWhat: o.subChildPartItem?.name || '', status: o.status, source: o.demandSource || '', salesOrder: '',
        });
      }
    }

    // One group per item + size.
    const groups = new Map();
    for (const r of rows) {
      const item = itemById.get(String(r.item));
      if (!item) continue;
      const key = `${r.item}|${r.dimensionVariantId || ''}`;
      if (!groups.has(key)) {
        const variant = r.dimensionVariantId ? (item.dimensionVariants || []).find(v => String(v._id) === String(r.dimensionVariantId)) : null;
        groups.set(key, {
          key,
          itemId: item._id,
          name: item.name,
          code: item.code,
          kind: KIND_LABEL[item.productKind] || (r.dimensionVariantId ? 'Fabrication' : 'Material'),
          size: variant ? variant.values : null,
          unit: r.dimensionVariantId ? 'piece(s)' : (item.unit || ''),
          stock: r.dimensionVariantId ? (variant?.subStock || 0) : (item.qty || 0),
          reserved: 0, issued: 0, remaining: 0,
          orders: [],
        });
      }
      const g = groups.get(key);
      const info = orderInfo.get(String(r.reservedByOrderId)) || { code: '(order not found)', kind: r.reservedByOrderModel, status: '' };
      const remaining = remainingOf(r);
      g.reserved = round3(g.reserved + (r.quantity || 0));
      g.issued = round3(g.issued + Math.min(r.issuedQuantity || 0, r.quantity || 0));
      g.remaining = round3(g.remaining + remaining);
      g.orders.push({
        orderId: r.reservedByOrderId, ...info, line: r.lineKey || '',
        reserved: r.quantity || 0, issued: r.issuedQuantity || 0, remaining, reservedAt: r.createdAt,
      });
    }

    const data = [...groups.values()].map(g => ({ ...g, free: round3(g.stock - g.remaining), short: g.stock - g.remaining < 0 }))
      .sort((a, b) => (a.free - b.free) || a.name.localeCompare(b.name));
    res.json({
      success: true,
      data,
      summary: {
        items: data.length,
        short: data.filter(g => g.short).length,
        orders: new Set(rows.map(r => String(r.reservedByOrderId))).size,
      },
    });
  } catch (error) {
    console.error('listReservations error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
