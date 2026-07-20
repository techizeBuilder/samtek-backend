import DispatchOrder from '../models/DispatchOrder.js';
import Order from '../models/Order.js';
import Customer from '../models/Customer.js';
import crypto from 'crypto';
import { sendSupportEmail } from '../utils/serviceEmail.js';

export const getDispatchedOrders = async (req, res) => {
    try {
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        
        // Fetch orders that have been Dispatched, In Transit, Delivered, or Closed
        const orders = await DispatchOrder.find({
            company: req.user.companyId,
            status: { $in: ['Dispatched', 'In Transit', 'Delivered', 'Closed'] }
        }).sort({ createdAt: -1 });
        
        res.status(200).json({ success: true, data: orders });
    } catch (error) {
        console.error('Error fetching dispatched orders:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

export const updateCustomerConfirmation = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, remarks } = req.body;
        
        const order = await DispatchOrder.findOneAndUpdate(
            { _id: id, company: req.user.companyId },
            { 
                $set: { 
                    'customerConfirmation.status': status,
                    'customerConfirmation.remarks': remarks || '',
                    'customerConfirmation.confirmedAt': new Date()
                } 
            },
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
// so one call here updates every machine's record together.
export const bulkUpdateCustomerConfirmation = async (req, res) => {
    try {
        const { ids, status, remarks } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'ids array is required' });
        }

        await DispatchOrder.updateMany(
            { _id: { $in: ids }, company: req.user.companyId },
            {
                $set: {
                    'customerConfirmation.status': status,
                    'customerConfirmation.remarks': remarks || '',
                    'customerConfirmation.confirmedAt': new Date()
                }
            }
        );

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
