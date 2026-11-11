// Is a fabrication size in use? (2026-10-28 — docs/fabrication-size-sync-2026-10.md §4)
//
// A size R&D removes from Fabrication Master may only leave the inventory
// item when nothing uses it: production finds a size by the inventory
// size's id, purchase by the size's numbers (dimensionSignature), and both
// keep copies — removing one that's in use would orphan them. Returns a
// list of plain-language reasons; empty = free to remove.
import mongoose from 'mongoose';
import { Item } from '../models/Inventory.js';
import ChildPartBOM from '../models/ChildPartBOM.js';
import MachineBOM from '../models/MachineBOM.js';
import RDBOM from '../models/RDBOM.js';
import SheetMetalPlan from '../models/SheetMetalPlan.js';
import ProductionOrder from '../models/ProductionOrder.js';
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import MaterialReservation from '../models/MaterialReservation.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import Purchase from '../models/Purchase.js';
import QCJob from '../models/QCJob.js';
import { dimensionSignature } from './fabricationDemandService.js';

const OPEN_PR = ['Pending', 'Approved', 'Ordered'];
const CLOSED_PO = ['Received', 'Cancelled', 'Rejected'];
const CLOSED_QC = ['Approved', 'Rejected'];
const LIMIT = 5; // names listed per kind; the rest is a count

const listOf = (label, names) => {
  if (!names.length) return null;
  const shown = names.slice(0, LIMIT).join(', ');
  return `${label}: ${shown}${names.length > LIMIT ? ` +${names.length - LIMIT} more` : ''}`;
};

// item: the inventory Item (lean or doc); variant: one of its dimensionVariants.
export async function sizeUsage(item, variant) {
  const companyId = item.companyId;
  const id = String(variant._id);
  const sig = dimensionSignature(variant.values);
  const sameSize = (lines) => (lines || []).some(l => dimensionSignature(l.values) === sig);
  const reasons = [];

  // 1. Stock on the size.
  if ((Number(variant.subStock) || 0) > 0) reasons.push(`${variant.subStock} pcs in stock`);

  // 2. BOM lines (live, not discontinued).
  const lineOn = { materials: { $elemMatch: { dimensionVariantId: id, isDiscontinued: { $ne: true } } } };
  const [cpBoms, mBoms, rdBoms] = await Promise.all([
    ChildPartBOM.find({ company: companyId, ...lineOn }).select('childPart').lean(),
    MachineBOM.find({ company: companyId, ...lineOn }).select('machine').lean(),
    RDBOM.find(lineOn).select('machine').lean(),
  ]);
  const bomItemIds = [...cpBoms.map(b => b.childPart), ...mBoms.map(b => b.machine), ...rdBoms.map(b => b.machine)];
  if (bomItemIds.length) {
    const codes = await Item.find({ _id: { $in: bomItemIds } }).select('code').lean();
    reasons.push(listOf('BOM', codes.map(c => c.code)));
  }

  // 3. Sub Child Parts made from it.
  const scps = await Item.find({ companyId, productKind: 'SubChildPart', 'subChildPartDetails.sourceDimensionVariantId': id }).select('code').lean();
  if (scps.length) reasons.push(listOf('Sub Child Part', scps.map(s => s.code)));

  // 4. Sheet Plans.
  if (await SheetMetalPlan.exists({ dimensionVariantId: id })) reasons.push('a Sheet Plan');

  // 5. Open orders: a material demand on it, or raw material sent from it.
  const [pos, jws] = await Promise.all([
    ProductionOrder.find({ company: companyId, status: { $ne: 'Completed' }, $or: [{ 'materialDemands.dimensionVariantId': id }, { 'rawMaterial.sentDimensionVariantId': id }] }).select('orderId').lean(),
    SubChildPartJobWorkOrder.find({ company: companyId, status: { $ne: 'Completed' }, 'rawMaterial.sentDimensionVariantId': id }).select('orderId').lean(),
  ]);
  const orders = [...pos, ...jws].map(o => o.orderId);
  if (orders.length) reasons.push(listOf('open order', orders));

  // 6. Reservations still waiting to be issued.
  if (mongoose.Types.ObjectId.isValid(id)) {
    const rows = await MaterialReservation.find({ company: companyId, dimensionVariantId: new mongoose.Types.ObjectId(id) }).select('quantity issuedQuantity').lean();
    if (rows.some(r => (Number(r.quantity) || 0) > (Number(r.issuedQuantity) || 0))) reasons.push('a stock reservation');
  }

  // 7–9. Purchase side — by the size's numbers.
  const [prs, pos2, qcs] = await Promise.all([
    PurchaseRequest.find({ companyId, status: { $in: OPEN_PR }, $or: [{ itemId: String(item._id) }, { materialCode: item.code }] })
      .select('requestId fabricationDimensionLines').lean(),
    Purchase.find({ companyId, status: { $nin: CLOSED_PO }, $or: [{ 'items.item': item._id }, { 'items.itemName': item.name }] })
      .select('purchaseOrderNumber items.item items.itemName items.fabricationDimensionLines').lean(),
    QCJob.find({ company: companyId, itemCode: item.code, status: { $nin: CLOSED_QC } }).select('qcJobId receivedSizes').lean(),
  ]);
  const openPrs = prs.filter(p => sameSize(p.fabricationDimensionLines)).map(p => p.requestId);
  if (openPrs.length) reasons.push(listOf('purchase request', openPrs));
  const mine = (l) => String(l.item) === String(item._id) || l.itemName === item.name;
  const openPos = pos2.filter(p => (p.items || []).some(l => mine(l) && sameSize(l.fabricationDimensionLines))).map(p => p.purchaseOrderNumber);
  if (openPos.length) reasons.push(listOf('PO', openPos));
  const openQc = qcs.filter(q => sameSize(q.receivedSizes)).map(q => q.qcJobId);
  if (openQc.length) reasons.push(listOf('QC job', openQc));

  return reasons.filter(Boolean);
}
