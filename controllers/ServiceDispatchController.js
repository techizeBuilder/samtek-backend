import DispatchOrder from '../models/DispatchOrder.js';
import Order from '../models/Order.js';
import Customer from '../models/Customer.js';
import crypto from 'crypto';
import { sendSupportEmail } from '../utils/serviceEmail.js';

const addMonths = (date, months) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
};

// Per-product warranty length, months (Item.warranty.period) — defaults to
// 12 if the product master has no warranty configured.
async function resolveWarrantyMonths(machineCode, machineName, companyId) {
  const { Item } = await import('../models/Inventory.js');
  const item = await Item.findOne({
    companyId,
    $or: [{ code: machineCode }, { name: machineName }]
  }).select('warranty.period').lean();
  return item?.warranty?.period ?? 12;
}

// AMC is one flat charge on the whole order (not per machine) — it only
// exists as a `hiddenCharge` row on the order's submitted OrderForm (see
// OrderFormModal.jsx / quotationCharges). True/false per order, cached by
// the caller so a multi-machine order only looks this up once.
async function resolveOrderHasAMC(orderCode, companyId) {
  const order = await Order.findOne({ orderCode, companyId }).select('_id').lean();
  if (!order) return false;
  const OrderForm = (await import('../models/OrderForm.js')).default;
  const form = await OrderForm.findOne({ orderId: order._id, status: 'Submitted' }).select('items').lean();
  if (!form) return false;
  return (form.items || []).some(it => it.hiddenCharge && /amc/i.test(it.itemName || ''));
}

// Warranty is genuinely per-machine (each product can have its own
// Item.warranty.period), so it's computed per DispatchOrder. AMC — when
// present on the order — starts only after THIS machine's own warranty
// ends (per the original design intent: "AMC tracks the paid contract
// period after warranty expires"), so it naturally varies per machine too
// even though "did the customer buy AMC" is a single yes/no per order.
async function computeWarrantyAndAmc(dispatchOrder, companyId, amcCache) {
  const months = await resolveWarrantyMonths(dispatchOrder.machineCode, dispatchOrder.machineName, companyId);
  const baseDate = dispatchOrder.actualDeliveryDate ? new Date(dispatchOrder.actualDeliveryDate) : new Date();
  const warrantyExpiryDate = addMonths(baseDate, months);

  let hasAmc = amcCache.get(dispatchOrder.orderId);
  if (hasAmc === undefined) {
    hasAmc = await resolveOrderHasAMC(dispatchOrder.orderId, companyId);
    amcCache.set(dispatchOrder.orderId, hasAmc);
  }
  // Fixed 12-month AMC term for now — no per-charge duration is configured
  // anywhere yet (Admin Settings only stores name/price/GST for the charge).
  const amcExpiryDate = hasAmc ? addMonths(warrantyExpiryDate, 12) : null;

  return { warrantyExpiryDate, amcExpiryDate };
}

export const getDispatchedOrders = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const query = {
            company: req.user.companyId,
            status: { $in: ['Dispatched', 'In Transit', 'Delivered', 'Closed'] }
        };

        // Consumers (Delivery Confirmation / Installation Schedule / Feedback &
        // Ratings) group these records by orderId client-side — every machine
        // of one order must arrive together for that grouping to stay correct.
        // orderId and customerName are identical across every machine of the
        // same order, so filtering on them here can only ever include/exclude
        // a WHOLE order's records, never split one order's machines apart.
        const { search, stage, bucket, page = 1, limit = 10 } = req.query;
        if (search) {
            query.$or = [
                { orderId: { $regex: search, $options: 'i' } },
                { customerName: { $regex: search, $options: 'i' } },
            ];
        }

        // Stage/bucket scoping — splits the 3 consuming pages' "active
        // worklist" tabs (Pending/Scheduled/Pending-Feedback) from their
        // "history" tab (Confirmed/Completed/Received). Safe to filter
        // directly on these status fields (no need to replicate the
        // Pending-vs-Issue/Scheduled-vs-Completed labeling rules here):
        // bulkUpdateCustomerConfirmation / bulkUpdateInstallationSchedule /
        // bulkUpdateFeedbackAndRatings each set the SAME value across every
        // machine of one order in a single updateMany, so these fields are
        // always uniform within an order — never mixed.
        if (stage === 'installation') {
            query['customerConfirmation.status'] = 'Reached Safely';
        } else if (stage === 'feedback') {
            query['installation.status'] = 'Completed';
        }

        if (stage === 'delivery') {
            query['customerConfirmation.status'] = bucket === 'history' ? 'Reached Safely' : { $ne: 'Reached Safely' };
        } else if (stage === 'installation') {
            query['installation.status'] = bucket === 'history' ? 'Completed' : { $ne: 'Completed' };
        } else if (stage === 'feedback') {
            query['feedback.rating'] = bucket === 'history' ? { $gt: 0 } : { $not: { $gt: 0 } };
        }

        if (bucket !== 'history') {
            // Active/operational worklist — bounded by status, not by count,
            // same as other current-work queues in this codebase.
            const orders = await DispatchOrder.find(query).sort({ createdAt: -1 });
            return res.status(200).json({ success: true, data: orders });
        }

        // History — paginate by ORDER (10 orders/page by default), not by
        // raw machine record, so one order's machines never get split
        // across a page boundary.
        const limitNum = Math.max(1, parseInt(limit, 10) || 10);
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const [{ groups = [], totalCount = [] } = {}] = await DispatchOrder.aggregate([
            { $match: query },
            { $group: { _id: '$orderId', latest: { $max: '$createdAt' } } },
            {
                $facet: {
                    groups: [{ $sort: { latest: -1 } }, { $skip: (pageNum - 1) * limitNum }, { $limit: limitNum }],
                    totalCount: [{ $count: 'count' }],
                }
            }
        ]);
        const pageOrderIds = groups.map(g => g._id);
        const total = totalCount[0]?.count || 0;

        const orders = pageOrderIds.length
            ? await DispatchOrder.find({ ...query, orderId: { $in: pageOrderIds } }).sort({ createdAt: -1 })
            : [];

        res.status(200).json({
            success: true,
            data: orders,
            pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
        });
    } catch (error) {
        console.error('Error fetching dispatched orders:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

export const updateCustomerConfirmation = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, remarks } = req.body;

        const existing = await DispatchOrder.findOne({ _id: id, company: req.user.companyId });
        if (!existing) return res.status(404).json({ success: false, message: 'Order not found' });

        const updateFields = {
            'customerConfirmation.status': status,
            'customerConfirmation.remarks': remarks || '',
            'customerConfirmation.confirmedAt': new Date()
        };

        // Stamp warranty/AMC expiry the FIRST time this machine is confirmed
        // as safely reached — never recomputed on a later remarks-only edit.
        if (status === 'Reached Safely' && existing.customerConfirmation?.status !== 'Reached Safely') {
            const { warrantyExpiryDate, amcExpiryDate } = await computeWarrantyAndAmc(existing, req.user.companyId, new Map());
            updateFields.warrantyExpiryDate = warrantyExpiryDate;
            if (amcExpiryDate) updateFields.amcExpiryDate = amcExpiryDate;
        }

        const order = await DispatchOrder.findOneAndUpdate(
            { _id: id, company: req.user.companyId },
            { $set: updateFields },
            { new: true }
        );

        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        res.status(200).json({ success: true, data: order });
    } catch (error) {
        console.error('Error updating confirmation:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Bulk (whole-order) variant of updateCustomerConfirmation — `ids` is every
// DispatchOrder (one per machine) of a single sales order. The customer only
// ever gets ONE delivery-confirmation conversation for the whole shipment,
// so one call here updates every machine's record together, and stamps
// warranty/AMC expiry on whichever of them are being confirmed for the
// first time (see computeWarrantyAndAmc).
export const bulkUpdateCustomerConfirmation = async (req, res) => {
    try {
        const { ids, status, remarks } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'ids array is required' });
        }

        const existingDocs = await DispatchOrder.find({ _id: { $in: ids }, company: req.user.companyId });
        if (!existingDocs.length) return res.status(404).json({ success: false, message: 'No matching orders found' });

        const baseFields = {
            'customerConfirmation.status': status,
            'customerConfirmation.remarks': remarks || '',
            'customerConfirmation.confirmedAt': new Date()
        };

        if (status === 'Reached Safely') {
            const newlyConfirmed = existingDocs.filter(d => d.customerConfirmation?.status !== 'Reached Safely');
            const alreadyConfirmedIds = existingDocs.filter(d => d.customerConfirmation?.status === 'Reached Safely').map(d => d._id);

            if (newlyConfirmed.length) {
                // Same order → same AMC lookup, computed once and reused
                // across every machine in this batch.
                const amcCache = new Map();
                const ops = await Promise.all(newlyConfirmed.map(async (d) => {
                    const { warrantyExpiryDate, amcExpiryDate } = await computeWarrantyAndAmc(d, req.user.companyId, amcCache);
                    const fields = { ...baseFields, warrantyExpiryDate };
                    if (amcExpiryDate) fields.amcExpiryDate = amcExpiryDate;
                    return { updateOne: { filter: { _id: d._id, company: req.user.companyId }, update: { $set: fields } } };
                }));
                await DispatchOrder.bulkWrite(ops);
            }
            if (alreadyConfirmedIds.length) {
                await DispatchOrder.updateMany({ _id: { $in: alreadyConfirmedIds }, company: req.user.companyId }, { $set: baseFields });
            }
        } else {
            await DispatchOrder.updateMany({ _id: { $in: ids }, company: req.user.companyId }, { $set: baseFields });
        }

        const orders = await DispatchOrder.find({ _id: { $in: ids }, company: req.user.companyId });
        if (!orders.length) return res.status(404).json({ success: false, message: 'No matching orders found' });
        res.status(200).json({ success: true, data: orders });
    } catch (error) {
        console.error('Error bulk-updating confirmation:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

export const updateInstallationSchedule = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, scheduledDate, technicianName, technicians, remarks } = req.body;

        // Fetch existing order
        const existingOrder = await DispatchOrder.findOne({ _id: id, company: req.user.companyId });
        if (!existingOrder) return res.status(404).json({ success: false, message: 'Order not found' });

        const wasNotCompleted = existingOrder.installation?.status !== 'Completed';
        const isNowCompleted = status === 'Completed';

        // Multiple technicians can be assigned; technicianName stays a
        // comma-joined string so older code paths (WhatsApp/email text,
        // feedback lookup) keep working unchanged.
        const cleanTechnicians = Array.isArray(technicians)
            ? technicians
                .map(t => ({ technicianId: t.technicianId || '', technicianName: t.technicianName || '' }))
                .filter(t => t.technicianName)
            : [];
        const joinedTechnicianName = cleanTechnicians.length
            ? cleanTechnicians.map(t => t.technicianName).join(', ')
            : (technicianName || '');

        const updateFields = {
            'installation.status': status,
            'installation.scheduledDate': scheduledDate ? new Date(scheduledDate) : null,
            'installation.technicianName': joinedTechnicianName,
            'installation.technicians': cleanTechnicians,
            'installation.remarks': remarks || ''
        };

        // Auto-fetch customer email if not already stored on the dispatch order
        let resolvedEmail = existingOrder.customerEmail || null;

        if (isNowCompleted && wasNotCompleted && !resolvedEmail) {
            // Strategy 1: Look up via orderCode in the Order collection
            try {
                const linkedOrder = await Order.findOne({ orderCode: existingOrder.orderId })
                    .populate('customer', 'email');
                if (linkedOrder?.customer?.email) {
                    resolvedEmail = linkedOrder.customer.email;
                }
            } catch (e) {
                console.warn('Could not fetch email via Order lookup:', e.message);
            }

            // Strategy 2: Fallback — match by mobile number in Customer collection
            if (!resolvedEmail && existingOrder.customerContact) {
                const mobile = existingOrder.customerContact.replace(/\D/g, '').slice(-10);
                try {
                    const customer = await Customer.findOne({
                        mobile,
                        companyId: req.user.companyId
                    }).select('email');
                    if (customer?.email) {
                        resolvedEmail = customer.email;
                    }
                } catch (e) {
                    console.warn('Could not fetch email via Customer mobile lookup:', e.message);
                }
            }

            // Save the resolved email back to the dispatch order so future lookups are instant
            if (resolvedEmail) {
                updateFields['customerEmail'] = resolvedEmail;
            }
        }

        // If marking as Completed for the first time, generate a feedback token
        let feedbackToken = null;
        if (isNowCompleted && wasNotCompleted) {
            feedbackToken = crypto.randomBytes(24).toString('hex');
            const tokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
            updateFields['feedback.feedbackToken'] = feedbackToken;
            updateFields['feedback.feedbackTokenExpiry'] = tokenExpiry;
        }

        const order = await DispatchOrder.findOneAndUpdate(
            { _id: id, company: req.user.companyId },
            { $set: updateFields },
            { new: true }
        );

        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        // Send feedback email if installation just completed
        if (isNowCompleted && wasNotCompleted && feedbackToken) {
            if (resolvedEmail) {
                const feedbackLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/feedback/${feedbackToken}`;
                sendSupportEmail({
                    type: 'INSTALLATION_COMPLETE',
                    to: resolvedEmail,
                    name: order.customerName || 'Customer',
                    data: {
                        machineName: order.machineName,
                        technicianName: joinedTechnicianName,
                        link: feedbackLink
                    }
                });
                console.log(`✅ Feedback email sent to ${resolvedEmail} for order ${order.orderId}`);
            } else {
                console.log(`ℹ️ Installation completed for order ${order.orderId} — no customer email found, feedback link not sent.`);
            }
        }

        res.status(200).json({
            success: true,
            data: order,
            emailSent: !!(isNowCompleted && wasNotCompleted && feedbackToken && resolvedEmail),
            customerEmail: resolvedEmail || null
        });
    } catch (error) {
        console.error('Error updating installation:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Bulk (whole-order) variant of updateInstallationSchedule — `ids` is every
// DispatchOrder of one sales order. The technician visit, schedule date, and
// (when completing) the feedback link/email are all one-per-order, not
// one-per-machine: only the FIRST id drives the "was this already Completed"
// check and the email lookup, one feedback token/email is generated and then
// copied onto every sibling record, so all machines resolve to the SAME
// public feedback link and one customer rating covers the whole shipment.
export const bulkUpdateInstallationSchedule = async (req, res) => {
    try {
        const { ids, status, scheduledDate, technicianName, technicians, remarks } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'ids array is required' });
        }

        const existingOrder = await DispatchOrder.findOne({ _id: ids[0], company: req.user.companyId });
        if (!existingOrder) return res.status(404).json({ success: false, message: 'Order not found' });

        const wasNotCompleted = existingOrder.installation?.status !== 'Completed';
        const isNowCompleted = status === 'Completed';

        const cleanTechnicians = Array.isArray(technicians)
            ? technicians
                .map(t => ({ technicianId: t.technicianId || '', technicianName: t.technicianName || '' }))
                .filter(t => t.technicianName)
            : [];
        const joinedTechnicianName = cleanTechnicians.length
            ? cleanTechnicians.map(t => t.technicianName).join(', ')
            : (technicianName || '');

        const updateFields = {
            'installation.status': status,
            'installation.scheduledDate': scheduledDate ? new Date(scheduledDate) : null,
            'installation.technicianName': joinedTechnicianName,
            'installation.technicians': cleanTechnicians,
            'installation.remarks': remarks || ''
        };

        let resolvedEmail = existingOrder.customerEmail || null;

        if (isNowCompleted && wasNotCompleted && !resolvedEmail) {
            try {
                const linkedOrder = await Order.findOne({ orderCode: existingOrder.orderId })
                    .populate('customer', 'email');
                if (linkedOrder?.customer?.email) {
                    resolvedEmail = linkedOrder.customer.email;
                }
            } catch (e) {
                console.warn('Could not fetch email via Order lookup:', e.message);
            }

            if (!resolvedEmail && existingOrder.customerContact) {
                const mobile = existingOrder.customerContact.replace(/\D/g, '').slice(-10);
                try {
                    const customer = await Customer.findOne({
                        mobile,
                        companyId: req.user.companyId
                    }).select('email');
                    if (customer?.email) {
                        resolvedEmail = customer.email;
                    }
                } catch (e) {
                    console.warn('Could not fetch email via Customer mobile lookup:', e.message);
                }
            }

            if (resolvedEmail) {
                updateFields['customerEmail'] = resolvedEmail;
            }
        }

        // One feedback token shared by every machine of this order.
        let feedbackToken = null;
        if (isNowCompleted && wasNotCompleted) {
            feedbackToken = crypto.randomBytes(24).toString('hex');
            const tokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
            updateFields['feedback.feedbackToken'] = feedbackToken;
            updateFields['feedback.feedbackTokenExpiry'] = tokenExpiry;
        }

        await DispatchOrder.updateMany(
            { _id: { $in: ids }, company: req.user.companyId },
            { $set: updateFields }
        );

        const orders = await DispatchOrder.find({ _id: { $in: ids }, company: req.user.companyId });
        if (!orders.length) return res.status(404).json({ success: false, message: 'No matching orders found' });

        // Send ONE feedback email for the whole order, not once per machine.
        if (isNowCompleted && wasNotCompleted && feedbackToken) {
            if (resolvedEmail) {
                const feedbackLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/feedback/${feedbackToken}`;
                sendSupportEmail({
                    type: 'INSTALLATION_COMPLETE',
                    to: resolvedEmail,
                    name: existingOrder.customerName || 'Customer',
                    data: {
                        machineName: ids.length > 1 ? `${existingOrder.machineName} (+${ids.length - 1} more)` : existingOrder.machineName,
                        technicianName: joinedTechnicianName,
                        link: feedbackLink
                    }
                });
                console.log(`✅ Feedback email sent to ${resolvedEmail} for order ${existingOrder.orderId} (${ids.length} machine(s))`);
            } else {
                console.log(`ℹ️ Installation completed for order ${existingOrder.orderId} — no customer email found, feedback link not sent.`);
            }
        }

        res.status(200).json({
            success: true,
            data: orders,
            emailSent: !!(isNowCompleted && wasNotCompleted && feedbackToken && resolvedEmail),
            customerEmail: resolvedEmail || null
        });
    } catch (error) {
        console.error('Error bulk-updating installation:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

export const updateFeedbackAndRatings = async (req, res) => {
    try {
        const { id } = req.params;
        const { rating, comments } = req.body;
        
        const order = await DispatchOrder.findOneAndUpdate(
            { _id: id, company: req.user.companyId },
            { 
                $set: { 
                    'feedback.rating': rating,
                    'feedback.comments': comments || '',
                    'feedback.collectedAt': new Date(),
                    'feedback.submittedViaForm': false
                } 
            },
            { new: true }
        );
        
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        res.status(200).json({ success: true, data: order });
    } catch (error) {
        console.error('Error updating feedback:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Bulk (whole-order) variant of updateFeedbackAndRatings — one rating from
// Complaint Management covers every machine of the order at once.
export const bulkUpdateFeedbackAndRatings = async (req, res) => {
    try {
        const { ids, rating, comments } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'ids array is required' });
        }

        await DispatchOrder.updateMany(
            { _id: { $in: ids }, company: req.user.companyId },
            {
                $set: {
                    'feedback.rating': rating,
                    'feedback.comments': comments || '',
                    'feedback.collectedAt': new Date(),
                    'feedback.submittedViaForm': false
                }
            }
        );

        const orders = await DispatchOrder.find({ _id: { $in: ids }, company: req.user.companyId });
        if (!orders.length) return res.status(404).json({ success: false, message: 'No matching orders found' });
        res.status(200).json({ success: true, data: orders });
    } catch (error) {
        console.error('Error bulk-updating feedback:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// PUBLIC: Get order info by feedback token (no auth needed)
// A token can be shared by every machine of one order (bulkUpdateInstallationSchedule
// stamps the same token onto all siblings), so this looks up ALL matching
// records — the customer still submits just one rating for the whole order.
export const getFeedbackByToken = async (req, res) => {
    try {
        const { token } = req.params;
        const orders = await DispatchOrder.find({ 'feedback.feedbackToken': token });

        if (!orders.length) {
            return res.status(404).json({ success: false, message: 'Invalid or expired feedback link.' });
        }
        const order = orders[0]; // representative — customerName/technician shared across siblings

        if (order.feedback.feedbackTokenExpiry && new Date() > order.feedback.feedbackTokenExpiry) {
            return res.status(400).json({ success: false, message: 'This feedback link has expired.' });
        }

        const machineNames = orders.map(o => o.machineName).filter(Boolean).join(', ');

        if (order.feedback.rating) {
            return res.status(200).json({
                success: true,
                alreadySubmitted: true,
                message: 'You have already submitted your feedback. Thank you!',
                data: {
                    customerName: order.customerName,
                    machineName: machineNames || order.machineName,
                    rating: order.feedback.rating,
                    comments: order.feedback.comments
                }
            });
        }

        res.status(200).json({
            success: true,
            alreadySubmitted: false,
            data: {
                customerName: order.customerName,
                machineName: machineNames || order.machineName,
                technicianName: order.installation?.technicianName || '',
                orderId: order.orderId
            }
        });
    } catch (error) {
        console.error('Error fetching feedback token:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// PUBLIC: Submit feedback via token (no auth needed) — applies the same
// rating/comments to every DispatchOrder sharing this token (see note above).
export const submitFeedbackByToken = async (req, res) => {
    try {
        const { token } = req.params;
        const { rating, comments } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: 'Please provide a rating between 1 and 5.' });
        }

        const orders = await DispatchOrder.find({ 'feedback.feedbackToken': token });

        if (!orders.length) {
            return res.status(404).json({ success: false, message: 'Invalid or expired feedback link.' });
        }
        const order = orders[0];

        if (order.feedback.feedbackTokenExpiry && new Date() > order.feedback.feedbackTokenExpiry) {
            return res.status(400).json({ success: false, message: 'This feedback link has expired.' });
        }

        if (order.feedback.rating) {
            return res.status(400).json({ success: false, message: 'Feedback has already been submitted.' });
        }

        await DispatchOrder.updateMany(
            { 'feedback.feedbackToken': token },
            {
                $set: {
                    'feedback.rating': rating,
                    'feedback.comments': comments || '',
                    'feedback.collectedAt': new Date(),
                    'feedback.submittedViaForm': true,
                },
                // Invalidate the token after use so it can't be resubmitted
                $unset: { 'feedback.feedbackToken': '', 'feedback.feedbackTokenExpiry': '' }
            }
        );

        res.status(200).json({
            success: true,
            message: 'Thank you for your feedback!',
            data: {
                customerName: order.customerName,
                machineName: orders.map(o => o.machineName).filter(Boolean).join(', ') || order.machineName,
                rating,
                comments: comments || ''
            }
        });
    } catch (error) {
        console.error('Error submitting feedback:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
