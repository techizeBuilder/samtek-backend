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

// PUBLIC: Get order info by feedback token (no auth needed)
export const getFeedbackByToken = async (req, res) => {
    try {
        const { token } = req.params;
        const order = await DispatchOrder.findOne({ 'feedback.feedbackToken': token });

        if (!order) {
            return res.status(404).json({ success: false, message: 'Invalid or expired feedback link.' });
        }

        if (order.feedback.feedbackTokenExpiry && new Date() > order.feedback.feedbackTokenExpiry) {
            return res.status(400).json({ success: false, message: 'This feedback link has expired.' });
        }

        if (order.feedback.rating) {
            return res.status(200).json({
                success: true,
                alreadySubmitted: true,
                message: 'You have already submitted your feedback. Thank you!',
                data: {
                    customerName: order.customerName,
                    machineName: order.machineName,
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
                machineName: order.machineName,
                technicianName: order.installation?.technicianName || '',
                orderId: order.orderId
            }
        });
    } catch (error) {
        console.error('Error fetching feedback token:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// PUBLIC: Submit feedback via token (no auth needed)
export const submitFeedbackByToken = async (req, res) => {
    try {
        const { token } = req.params;
        const { rating, comments } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: 'Please provide a rating between 1 and 5.' });
        }

        const order = await DispatchOrder.findOne({ 'feedback.feedbackToken': token });

        if (!order) {
            return res.status(404).json({ success: false, message: 'Invalid or expired feedback link.' });
        }

        if (order.feedback.feedbackTokenExpiry && new Date() > order.feedback.feedbackTokenExpiry) {
            return res.status(400).json({ success: false, message: 'This feedback link has expired.' });
        }

        if (order.feedback.rating) {
            return res.status(400).json({ success: false, message: 'Feedback has already been submitted.' });
        }

        order.feedback.rating = rating;
        order.feedback.comments = comments || '';
        order.feedback.collectedAt = new Date();
        order.feedback.submittedViaForm = true;
        // Invalidate token after use
        order.feedback.feedbackToken = null;
        order.feedback.feedbackTokenExpiry = null;

        await order.save();

        res.status(200).json({
            success: true,
            message: 'Thank you for your feedback!',
            data: {
                customerName: order.customerName,
                machineName: order.machineName,
                rating: order.feedback.rating,
                comments: order.feedback.comments
            }
        });
    } catch (error) {
        console.error('Error submitting feedback:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
