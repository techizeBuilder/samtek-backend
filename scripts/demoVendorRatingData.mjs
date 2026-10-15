// Run from the server folder:  node scripts/demoVendorRatingData.mjs   (add)  |  node scripts/demoVendorRatingData.mjs --remove   (take it out)
// Demo data for testing Vendor Ratings / Price History (2026-10-12, user):
// 8 past deliveries from ONE vendor ("rahul vendor") over the last year —
// a received PO + request + QC result each. Tagged DEMO- (PO numbers,
// request ids, QC job ids, notes) so `--remove` takes it all out again.
// No bills, payments or ledger entries.
const REMOVE = process.argv.includes('--remove');
const base = 'file:///D:/cs/Samtek-Backend/Samtek-Backend/server/';
process.chdir('D:/cs/Samtek-Backend/Samtek-Backend/server');
await import(base + 'config/environment.js');
const { createRequire } = await import('node:module');
const mongoose = (await import('file:///' + createRequire(base + 'index.js').resolve('mongoose').split(String.fromCharCode(92)).join('/'))).default;
await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
const db = mongoose.connection.db;
const oid = (x) => new mongoose.Types.ObjectId(x);
const companyId = oid('6a2111880239bcb8cfedf6a7');
const vendorId = oid('6a339276ca419fe3bad151bd'); // rahul vendor
const DEMO = /^DEMO-/;

async function remove() {
  const pos = await db.collection('purchases').find({ companyId, purchaseOrderNumber: DEMO }).project({ _id: 1 }).toArray();
  const prs = await db.collection('purchaserequests').find({ companyId, requestId: DEMO }).project({ _id: 1 }).toArray();
  const r = [
    await db.collection('qcjobs').deleteMany({ company: companyId, qcJobId: DEMO }),
    await db.collection('purchaserequests').deleteMany({ _id: { $in: prs.map(p => p._id) } }),
    await db.collection('purchases').deleteMany({ _id: { $in: pos.map(p => p._id) } }),
  ];
  console.log('removed — QC jobs', r[0].deletedCount, '| requests', r[1].deletedCount, '| POs', r[2].deletedCount);
}

if (REMOVE) { await remove(); await mongoose.disconnect(); process.exit(0); }
if (await db.collection('purchases').countDocuments({ companyId, purchaseOrderNumber: DEMO })) {
  console.log('Demo data already there — run with --remove first.'); await mongoose.disconnect(); process.exit(1);
}

const vendor = await db.collection('suppliers').findOne({ _id: vendorId, companyId });
const items = await db.collection('items').find({ _id: { $in: vendor.suppliedItems }, fabricationRef: { $in: [null, undefined] } }).project({ name: 1, code: 1, unit: 1, purchaseUnit: 1 }).toArray();
const byName = (re) => items.find(i => re.test(i.name));
const bolts = byName(/nut bolts/i), gen = byName(/generator/i), bearing = byName(/bairing|bearing/i), tool = byName(/tool/i);
const pick = [bolts, gen, bearing, tool].filter(Boolean);
console.log('vendor:', vendor.supplierName, '| items:', pick.map(i => `${i.name} (${i.purchaseUnit || i.unit})`).join(', '));
const second = gen || tool;
if (!bolts || !second) { console.log('expected items not linked to this vendor — stopping'); process.exit(1); }

const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY);
// [item, qty, price, orderedDaysAgo, deliveryDays, receivedDaysAgo, qc: 'pass'|'fail'|'partial']
const plan = [
  [bolts, 50, 120, 370, 10, 360, 'pass'],    // on time
  [second, 2, gen ? 15000 : 2500, 265, 14, 250, 'pass'],     // on time (1 day early)
  [bolts, 40, 118, 195, 7, 180, 'partial'],  // 8 days late; 4 kg rejected, rest passed
  [bearing || bolts, 20, bearing ? 450 : 121, 105, 10, 95, 'pass'], // on time
  [bolts, 60, 125, 55, 7, 45, 'pass'],       // 3 days late
  [second, 1, gen ? 14500 : 2400, 35, 10, 25, 'pass'],       // on time
  [bolts, 30, 122, 20, 7, 12, 'fail'],       // on time, QC failed it all
  [bolts, 45, 119, 10, 7, 4, 'pass'],        // on time
];

let n = 0;
for (const [item, qty, price, orderedAgo, days, receivedAgo, qc] of plan) {
  n += 1;
  const tag = String(n).padStart(2, '0');
  const unit = item.purchaseUnit || item.unit || 'Pieces';
  const orderDate = ago(orderedAgo);
  const expected = new Date(orderDate.getTime() + days * DAY);
  const receivedAt = ago(receivedAgo);
  const poId = new mongoose.Types.ObjectId();
  const prId = new mongoose.Types.ObjectId();
  const net = qty * price;
  const gst = Math.round(net * 0.18 * 100) / 100;
  const notes = 'DEMO data for testing Vendor Ratings / Price History (2026-10-12) — safe to delete';
  await db.collection('purchaserequests').insertOne({
    _id: prId, requestId: `DEMO-PR-${tag}`, productName: item.name, itemId: String(item._id), quantity: qty, unit,
    purchaseUnit: unit, purchaseQuantity: qty, receivedQuantity: qty, convertedQuantity: qty, status: 'Received', receivedAt,
    purchaseOrder: poId, companyId, storeApproved: true, notes, createdAt: orderDate, updatedAt: receivedAt,
  });
  await db.collection('purchases').insertOne({
    _id: poId, purchaseOrderNumber: `DEMO-PO-${tag}`, supplier: vendorId, companyId, unit: vendor.unit || 'test unit',
    status: 'Received', paymentStatus: 'Paid', orderDate, createdAt: orderDate, updatedAt: receivedAt,
    expectedDeliveryDate: expected, deliveryClock: { startsOn: 'order', startedAt: orderDate },
    items: [{ _id: new mongoose.Types.ObjectId(), item: item._id, itemName: item.name, quantity: qty, unitPrice: price, totalPrice: net,
      gstInclusive: false, gstRate: 18, gstAmount: gst, purchaseUnit: unit, purchaseRequests: [prId], expectedDeliveryDate: expected, deliveryDays: days,
      receivedQuantity: qty, pendingQuantity: 0, deliveryDateHistory: [], cancelled: null }],
    purchaseRequests: [prId], totalAmount: net, taxAmount: gst, grandTotal: net + gst, charges: [], chargesTotal: 0, chargesGstTotal: 0,
    paymentTerms: { advancePercent: null, creditDays: null, others: [] }, transportBy: 'Vendor', notes,
    approval: { required: false }, cancellations: [],
  });
  const rejected = qc === 'partial' ? Math.round(qty * 0.1) : 0;
  await db.collection('qcjobs').insertOne({
    qcJobId: `DEMO-QC-${tag}`, source: 'Purchase', sourceRefId: `DEMO-PO-${tag}`, purchaseRequestId: prId, sourceDepartment: 'Store',
    itemName: item.name, itemCode: String(item._id), category: 'Raw Material', quantity: qty - rejected, unit,
    status: qc === 'fail' ? 'Rejected' : 'Approved', decision: qc === 'fail' ? 'Fail' : 'Pass',
    failReason: qc === 'fail' ? 'Threads damaged (demo)' : '', partialRejections: rejected ? [{ qty: rejected, reason: 'Bent pieces (demo)', rejectedAt: receivedAt }] : [],
    acceptedQty: qc === 'fail' ? null : qty - rejected, transferredToStore: qc !== 'fail', returnedToSource: qc !== 'pass',
    company: companyId, createdAt: receivedAt, updatedAt: receivedAt, notes,
  });
  console.log(`  DEMO-PO-${tag}: ${item.name} ${qty} ${unit} @ ₹${price} · ordered ${orderedAgo}d ago, due +${days}d, received ${receivedAgo}d ago (${receivedAt <= expected ? 'on time' : 'late'}) · QC ${qc}`);
}

// What the vendor score now says.
await import(base + 'models/Supplier.js');
await import(base + 'models/Purchase.js');
const { computeVendorScores } = await import(base + 'services/vendorScoreService.js');
const r = (await computeVendorScores({ companyId, vendorIds: [vendorId] })).get(String(vendorId));
console.log('\nscore:', r.score, '/ 100 | parts', Object.fromEntries(Object.entries(r.parts).map(([k, p]) => [k, p.pct])), '| on time', `${r.counts.onTime.on}/${r.counts.onTime.total}`, '| QC accepted', `${r.counts.qc.acceptedPct}%`);
await mongoose.disconnect(); process.exit(0);
