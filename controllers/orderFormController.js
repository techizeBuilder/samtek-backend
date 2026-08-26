import mongoose from 'mongoose';
import OrderForm from '../models/OrderForm.js';
import Order from '../models/Order.js';
import Lead from '../models/Lead.js';
import Customer from '../models/Customer.js';
import notificationService from '../services/notificationService.js';
import { syncOrderItemsFromForm, autoCheckAllOrderItems } from '../services/storeFlowService.js';
import { computeBOMMaterialsMrpCost } from '../services/itemPricingService.js';
import { computeMaterialAvailabilityForOrder } from '../services/materialAvailabilityService.js';

const isSuperadmin = (role) => role === 'Superadmin' || role === 'Super Admin';
const isAccountsRole = (role) => ['Accounts', 'Accounts Head', 'Account Employee'].includes(role) || isSuperadmin(role);

// ─── GET /api/order-forms/by-order/:orderId ────────────────────────────────
// Used by the Leads page to check whether a verified order already has a
// submitted/returned Order Form (404 means "not filled yet").
export const getByOrderId = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid order ID' });
    }

    const form = await OrderForm.findOne({ orderId })
      .populate('filledBy', 'fullName username')
      .populate('returnedBy', 'fullName username');

    if (!form) {
      return res.status(404).json({ success: false, message: 'Order Form not filled yet' });
    }
    if (!isSuperadmin(req.user.role) && form.companyId.toString() !== req.user.companyId?.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, orderForm: form });
  } catch (error) {
    console.error('Error fetching Order Form by order:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── PUT /api/order-forms/by-order/:orderId ────────────────────────────────
// Single handler for create / resubmit / Accounts direct-edit — "one form per
// order" makes create-vs-update indistinguishable from the caller's side.
export const upsertOrderForm = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid order ID' });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const superadmin = isSuperadmin(req.user.role);
    if (!superadmin && order.companyId.toString() !== req.user.companyId?.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (order.serviceVerification?.status !== 'verified') {
      return res.status(400).json({
        success: false,
        message: 'Order must be Service/Deal Verified before the Order Form can be filled.'
      });
    }

    const accountsCaller = isAccountsRole(req.user.role);
    const isOwningSalesperson = order.salesPerson && order.salesPerson.toString() === req.user._id.toString();

    if (!accountsCaller && !isOwningSalesperson) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned salesperson or Accounts can fill this Order Form.'
      });
    }

    const existing = await OrderForm.findOne({ orderId });
    if (existing && existing.status === 'Submitted' && !accountsCaller) {
      return res.status(403).json({
        success: false,
        message: 'Order Form is locked. It has already been submitted.'
      });
    }

    const {
      customerName, mobile, email, companyName, gstNumber, companyAddress, state, pin,
      quotationNo, orderType, orderFormOrderId, orderDate, deliveryDate, issueDate,
      receivedAmount, paymentType, balanceAmount, wayOfPayment, paymentReceiverAC, paymentDate,
      items,
    } = req.body;

    // Never trust client-submitted totals — recompute server-side from the items array.
    const cleanItems = Array.isArray(items) ? items.map((it, idx) => ({
      sNo: idx + 1,
      mcCode: it.mcCode || '',
      itemName: it.itemName || '',
      specification: it.specification || '',
      hsnCode: it.hsnCode || '',
      qty: Number(it.qty) || 0,
      billAmount: Number(it.billAmount) || 0,
      gstAmount: Number(it.gstAmount) || 0,
      quotationAmount: Number(it.quotationAmount) || 0,
      cashAmount: Number(it.cashAmount) || 0,
      discountAmount: Number(it.discountAmount) || 0,
      hiddenCharge: !!it.hiddenCharge,
    })) : [];

    // Received Amount (advance payment) and Bill Amount are what make the
    // Order Form actionable for Accounts — without them there's nothing to
    // reconcile against the order, so both are mandatory on submit.
    if (!(Number(receivedAmount) > 0)) {
      return res.status(400).json({
        success: false,
        message: 'Received Amount (Advance Payment) is required and must be greater than 0.'
      });
    }
    if (cleanItems.filter(it => !it.hiddenCharge).some(it => !(it.billAmount > 0))) {
      return res.status(400).json({
        success: false,
        message: 'Bill Amount is required for every item row.'
      });
    }

    // BOM-based minimum Billing Amount — an item's Bill Amount must clear its
    // own BOM material cost (Σ material MRP × qty) by more than 10%, so a
    // sale is never billed at/below what it cost to build. Items with no
    // RDMachine/BOM for their code are skipped entirely — nothing to compare.
    const bomChecks = await Promise.all(
      cleanItems
        .filter(it => !it.hiddenCharge && it.mcCode)
        .map(async (it) => {
          const bom = await computeBOMMaterialsMrpCost(it.mcCode, order.companyId);
          if (!bom.found) return null;
          const minBillAmount = bom.totalCost * 1.1;
          if (it.billAmount <= minBillAmount) {
            return { mcCode: it.mcCode, itemName: it.itemName, bomCost: bom.totalCost, minBillAmount, billAmount: it.billAmount };
          }
          return null;
        })
    );
    const bomFailures = bomChecks.filter(Boolean);
    if (bomFailures.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Billing Amount must be above 10% of BOM cost for: ${bomFailures.map(f => `${f.itemName || f.mcCode} (min ₹${Math.round(f.minBillAmount).toLocaleString('en-IN')}, BOM cost ₹${Math.round(f.bomCost).toLocaleString('en-IN')})`).join('; ')}`,
        bomFailures
      });
    }

    const totals = cleanItems.reduce((acc, it) => {
      acc.qty += it.qty;
      acc.billAmount += it.billAmount;
      acc.gstAmount += it.gstAmount;
      acc.quotationAmount += it.quotationAmount;
      acc.cashAmount += it.cashAmount;
      acc.discountAmount += it.discountAmount;
      return acc;
    }, { qty: 0, billAmount: 0, gstAmount: 0, quotationAmount: 0, cashAmount: 0, discountAmount: 0 });

    // Outstanding = this form's Bill Amount + GST Amount minus the
    // originating lead's own advance payment (not the customer's cumulative
    // advance across other deals). Tracked as a delta against the form's
    // *previous* contribution so resubmission never double-counts.
    let advancePaid = 0;
    if (order.leadId) {
      const lead = await Lead.findById(order.leadId).select('advancedPaymentAmount');
      advancePaid = lead?.advancedPaymentAmount || 0;
    }
    const newContribution = Math.max(0, totals.billAmount + totals.gstAmount - advancePaid);
    const previousContribution = existing?.outstandingContribution || 0;

    const payload = {
      orderId: order._id,
      leadId: order.leadId || null,
      companyId: order.companyId,
      customerName, mobile, email, companyName, gstNumber, companyAddress, state, pin,
      quotationNo, orderType, orderFormOrderId,
      orderDate: orderDate || null,
      deliveryDate: deliveryDate || null,
      issueDate: issueDate || null,
      receivedAmount: Number(receivedAmount) || 0,
      paymentType,
      balanceAmount: Number(balanceAmount) || 0,
      wayOfPayment,
      paymentReceiverAC,
      paymentDate: paymentDate || null,
      items: cleanItems,
      totals,
      outstandingContribution: newContribution,
      status: 'Submitted',
      filledBy: req.user._id,
      submittedAt: new Date(),
      returnRemark: '',
      returnedBy: null,
      returnedAt: null,
    };

    if (accountsCaller) {
      payload.lastEditedByAccounts = req.user._id;
      payload.lastEditedAt = new Date();
    }

    const form = await OrderForm.findOneAndUpdate(
      { orderId: order._id },
      { $set: payload },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    order.orderFormCompleted = true;
    await order.save();

    // 🔄 The Order Form's item table is the source of truth for the order's
    // items — sync them into Order.products and the Sale scoreboard so the
    // whole downstream flow (Store → QC/Production/Purchase → Dispatch)
    // processes every item with its quantity, not just the lead's one item.
    try {
      const syncResult = await syncOrderItemsFromForm(order, cleanItems);
      console.log(`🔄 [OrderForm] Item sync for ${order.orderCode}:`, syncResult);
    } catch (syncErr) {
      console.error('❌ Error syncing Order Form items into Order/Sale:', syncErr);
    }

    // 🤖 New requirement: Store's per-item inventory check/routing (Available →
    // QC, Not Available → Purchase/Production) now runs automatically the
    // moment the Order Form is submitted — same logic as Store's "Check All
    // Items" button, just no longer requiring that manual click. Store's page
    // keeps showing the result exactly as it did before.
    try {
      const autoCheckResult = await autoCheckAllOrderItems(order, req.user);
      console.log(`🤖 [OrderForm] Auto store-check for ${order.orderCode}:`, autoCheckResult);
    } catch (autoCheckErr) {
      console.error('❌ Error auto-checking inventory for Order Form items:', autoCheckErr);
    }

    // 📦 BOM raw-material availability for every In-house Manufactured item on
    // this order — checks stock, auto-raises pre-approved Purchase Requests
    // for any shortfall (see materialAvailabilityService.js). Shipped as an
    // awaited step first, same as autoCheckAllOrderItems right above it, to
    // measure real added latency before reaching for a fire-and-forget
    // version — see server/docs/store-orders-material-availability.md.
    try {
      const materialAvailabilityResult = await computeMaterialAvailabilityForOrder(order);
      console.log(`📦 [OrderForm] Material availability for ${order.orderCode}:`, materialAvailabilityResult);
    } catch (materialAvailabilityErr) {
      console.error('❌ Error computing material availability for Order Form items:', materialAvailabilityErr);
    }

    if (newContribution !== previousContribution) {
      await Customer.findByIdAndUpdate(order.customer, {
        $inc: { outstandingAmount: newContribution - previousContribution }
      });
    }

    try {
      await notificationService.triggerAccountsNotification({
        action: 'order_form_submitted',
        data: {
          orderId: order._id,
          orderCode: order.orderCode,
          submittedBy: req.user.username,
        },
        targetCompanyId: order.companyId,
      });

      // ✅ Store is notified only now (Order Form filled) — not at deal verification,
      // because the item reaches Store only after the form is submitted.
      // Skip re-notify on Accounts edits of an already-submitted form.
      if (existing?.status !== 'Submitted') {
        await notificationService.triggerStoreNotification({
          action: 'new_order_for_store',
          data: { orderCode: order.orderCode, orderId: order._id },
          targetUnit: order.unit,
          targetCompanyId: order.companyId,
        });
      }
    } catch (e) { console.error('Order Form submit notification error:', e); }

    res.json({ success: true, message: 'Order Form submitted successfully', orderForm: form });
  } catch (error) {
    console.error('Error submitting Order Form:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── PATCH /api/order-forms/:id/return ─────────────────────────────────────
// Accounts-only: sends the form back to the salesperson with a remark, and
// revokes Store eligibility until it's resubmitted.
export const returnOrderForm = async (req, res) => {
  try {
    const { id } = req.params;
    const { remark } = req.body;
    if (!remark || !remark.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A remark is required when returning an Order Form for correction.'
      });
    }

    const form = await OrderForm.findById(id);
    if (!form) return res.status(404).json({ success: false, message: 'Order Form not found' });

    if (!isSuperadmin(req.user.role) && form.companyId.toString() !== req.user.companyId?.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (form.status !== 'Submitted') {
      return res.status(400).json({
        success: false,
        message: 'Only a submitted Order Form can be returned for correction.'
      });
    }

    const order = await Order.findById(form.orderId);

    // Pull this form's contribution back out of the customer's Outstanding
    // until it's corrected and resubmitted.
    if (order?.customer && form.outstandingContribution) {
      await Customer.findByIdAndUpdate(order.customer, {
        $inc: { outstandingAmount: -form.outstandingContribution }
      });
    }

    form.status = 'Returned';
    form.returnRemark = remark.trim();
    form.returnedBy = req.user._id;
    form.returnedAt = new Date();
    form.outstandingContribution = 0;
    await form.save();

    if (order) {
      order.orderFormCompleted = false;
      await order.save();
    }

    try {
      if (order?.salesPerson) {
        await notificationService.createNotification({
          title: 'Order Form Returned for Correction',
          message: `Order Form for ${order.orderCode} was returned for correction: ${remark.trim()}`,
          type: 'account',
          icon: 'alert-triangle',
          priority: 'high',
          targetUserId: order.salesPerson,
          targetCompanyId: order.companyId,
          data: { orderId: form.orderId, orderFormId: form._id, remark: remark.trim() },
        });
      }
    } catch (e) { console.error('Order Form return notification error:', e); }

    res.json({ success: true, message: 'Order Form returned for correction', orderForm: form });
  } catch (error) {
    console.error('Error returning Order Form:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/order-forms ───────────────────────────────────────────────────
// Accounts-only list view.
export const listOrderFormsForAccounts = async (req, res) => {
  try {
    const { page = 1, limit = 20, status = '', search = '' } = req.query;

    const filter = {};
    if (!isSuperadmin(req.user.role) && req.user.companyId) {
      filter.companyId = req.user.companyId;
    }
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { customerName: { $regex: search, $options: 'i' } },
        { companyName: { $regex: search, $options: 'i' } },
        { quotationNo: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const [forms, total] = await Promise.all([
      OrderForm.find(filter)
        .populate('orderId', 'orderCode totalAmount')
        .populate('leadId', 'leadCode companyName')
        .populate('filledBy', 'fullName username')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limitNum),
      OrderForm.countDocuments(filter),
    ]);

    res.json({
      success: true,
      orderForms: forms,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalOrders: total,
      },
    });
  } catch (error) {
    console.error('Error listing Order Forms:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/order-forms/:id ───────────────────────────────────────────────
// Full detail fetch for the read-only "View Order Form" screen.
export const getFormById = async (req, res) => {
  try {
    const { id } = req.params;
    const form = await OrderForm.findById(id)
      .populate('orderId', 'orderCode totalAmount status salesPerson')
      .populate('leadId', 'leadCode companyName contactPerson')
      .populate('filledBy', 'fullName username')
      .populate('returnedBy', 'fullName username');

    if (!form) return res.status(404).json({ success: false, message: 'Order Form not found' });
    if (!isSuperadmin(req.user.role) && form.companyId.toString() !== req.user.companyId?.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, orderForm: form });
  } catch (error) {
    console.error('Error fetching Order Form:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
