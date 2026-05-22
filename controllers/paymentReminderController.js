import Sale from '../models/Sale.js';
import Customer from '../models/Customer.js';
import { Company } from '../models/Company.js';
import PaymentReminderSettings from '../models/PaymentReminderSettings.js';
import { sendPaymentReminderEmail } from '../services/emailService.js';
import mongoose from 'mongoose';

// ─── GET Settings ─────────────────────────────────────────────────────────────
export const getReminderSettings = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        let settings = await PaymentReminderSettings.findOne({ companyId });
        if (!settings) {
            // Return defaults if not yet configured
            settings = {
                companyId,
                firstReminderDays: 7,
                secondReminderDays: 15,
                overdueAfterDays: 30,
                autoEmailEnabled: false,
                reminderFrequencyDays: 7
            };
        }
        res.json({ success: true, data: settings });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── SAVE / UPDATE Settings ───────────────────────────────────────────────────
export const saveReminderSettings = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { firstReminderDays, secondReminderDays, overdueAfterDays, autoEmailEnabled, reminderFrequencyDays } = req.body;

        const settings = await PaymentReminderSettings.findOneAndUpdate(
            { companyId },
            { firstReminderDays, secondReminderDays, overdueAfterDays, autoEmailEnabled, reminderFrequencyDays },
            { upsert: true, new: true }
        );
        res.json({ success: true, data: settings, message: 'Settings saved successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET Overdue / Pending Invoices ──────────────────────────────────────────
export const getOverdueInvoices = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const settings = await PaymentReminderSettings.findOne({ companyId });
        const overdueAfterDays = settings?.overdueAfterDays || 30;
        const today = new Date();

        // Fetch all unpaid / partial invoices
        const invoices = await Sale.find({
            companyId,
            paymentStatus: { $in: ['Pending', 'Partially Paid', 'Overdue'] }
        })
        .populate('customer', 'name email mobile city state')
        .sort({ dueDate: 1 })
        .lean();

        // Enrich with overdue data
        const enriched = invoices.map(inv => {
            const dueDate = new Date(inv.dueDate);
            const msPerDay = 1000 * 60 * 60 * 24;
            const daysFromDue = Math.floor((today - dueDate) / msPerDay);
            const isOverdue = daysFromDue > 0;
            const daysFromInvoice = Math.floor((today - new Date(inv.saleDate)) / msPerDay);

            return {
                ...inv,
                daysOverdue: isOverdue ? daysFromDue : 0,
                daysFromInvoice,
                isOverdue,
                overdueLevel: daysFromDue > overdueAfterDays ? 'critical' : daysFromDue > 0 ? 'warning' : 'normal',
                balanceAmount: inv.totalAmount - (inv.paidAmount || 0)
            };
        });

        const overdueList = enriched.filter(i => i.isOverdue);
        const pendingList = enriched.filter(i => !i.isOverdue);

        res.json({
            success: true,
            data: {
                overdue: overdueList,
                pending: pendingList,
                summary: {
                    totalOverdue: overdueList.length,
                    totalPending: pendingList.length,
                    totalOverdueAmount: overdueList.reduce((s, i) => s + i.balanceAmount, 0),
                    totalPendingAmount: pendingList.reduce((s, i) => s + i.balanceAmount, 0)
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── SEND Manual Reminder Email ───────────────────────────────────────────────
export const sendManualReminder = async (req, res) => {
    try {
        const { invoiceId } = req.body;
        const companyId = req.user.companyId;

        const invoice = await Sale.findById(invoiceId).populate('customer', 'name email mobile');
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

        const company = await Company.findById(companyId);
        const customer = invoice.customer;

        if (!customer?.email) {
            return res.status(400).json({ success: false, message: `Customer "${customer?.name}" has no email on file.` });
        }

        const today = new Date();
        const dueDate = new Date(invoice.dueDate);
        const daysOverdue = Math.max(0, Math.floor((today - dueDate) / (1000 * 60 * 60 * 24)));
        const balanceAmount = invoice.totalAmount - (invoice.paidAmount || 0);

        const result = await sendPaymentReminderEmail({
            to: customer.email,
            customerName: customer.name,
            invoiceNo: invoice.invoiceNumber,
            totalAmount: invoice.totalAmount,
            paidAmount: invoice.paidAmount || 0,
            balanceAmount,
            dueDate: invoice.dueDate,
            companyName: company?.name || company?.unitName || 'Samtek',
            daysOverdue
        });

        // Log the reminder in invoice
        await Sale.findByIdAndUpdate(invoiceId, {
            $push: { reminderSentDates: { sentAt: new Date(), type: daysOverdue > 0 ? 'overdue' : 'first' } }
        });

        res.json({ success: true, message: `Reminder email sent to ${customer.email}`, result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── CRON JOB — Run Daily Auto Reminders ─────────────────────────────────────
export const runDailyReminderCron = async () => {
    try {
        console.log('🕐 Running Daily Payment Reminder Cron Job...');
        const today = new Date();
        const msPerDay = 1000 * 60 * 60 * 24;

        // Get all companies with auto email enabled
        const allSettings = await PaymentReminderSettings.find({ autoEmailEnabled: true });

        for (const settings of allSettings) {
            const companyId = settings.companyId;
            const company = await Company.findById(companyId);

            // Fetch unpaid invoices for this company
            const invoices = await Sale.find({
                companyId,
                paymentStatus: { $in: ['Pending', 'Partially Paid', 'Overdue'] }
            }).populate('customer', 'name email state');

            for (const invoice of invoices) {
                const customer = invoice.customer;
                if (!customer?.email) continue;

                const dueDate = new Date(invoice.dueDate);
                const saleDate = new Date(invoice.saleDate);
                const daysFromInvoice = Math.floor((today - saleDate) / msPerDay);
                const daysFromDue = Math.floor((today - dueDate) / msPerDay);
                const balanceAmount = invoice.totalAmount - (invoice.paidAmount || 0);

                // Determine if reminder should be sent
                const alreadySentTypes = invoice.reminderSentDates?.map(r => r.type) || [];
                let shouldSend = false;
                let reminderType = 'first';

                if (daysFromDue > 0 && !alreadySentTypes.includes('overdue')) {
                    // Overdue reminder
                    const lastOverdue = invoice.reminderSentDates?.filter(r => r.type === 'overdue').pop();
                    const daysSinceLastOverdue = lastOverdue
                        ? Math.floor((today - new Date(lastOverdue.sentAt)) / msPerDay)
                        : settings.reminderFrequencyDays + 1;

                    if (daysSinceLastOverdue >= settings.reminderFrequencyDays) {
                        shouldSend = true;
                        reminderType = 'overdue';
                    }
                } else if (daysFromInvoice >= settings.secondReminderDays && !alreadySentTypes.includes('second')) {
                    shouldSend = true;
                    reminderType = 'second';
                } else if (daysFromInvoice >= settings.firstReminderDays && !alreadySentTypes.includes('first')) {
                    shouldSend = true;
                    reminderType = 'first';
                }

                if (shouldSend) {
                    await sendPaymentReminderEmail({
                        to: customer.email,
                        customerName: customer.name,
                        invoiceNo: invoice.invoiceNumber,
                        totalAmount: invoice.totalAmount,
                        paidAmount: invoice.paidAmount || 0,
                        balanceAmount,
                        dueDate: invoice.dueDate,
                        companyName: company?.name || 'Samtek',
                        daysOverdue: Math.max(0, daysFromDue)
                    });

                    // Log reminder
                    await Sale.findByIdAndUpdate(invoice._id, {
                        $push: { reminderSentDates: { sentAt: today, type: reminderType } }
                    });

                    console.log(`📧 Auto reminder (${reminderType}) sent to ${customer.email} for ${invoice.invoiceNumber}`);
                }

                // Auto update to Overdue if past due date
                if (daysFromDue > 0 && invoice.paymentStatus !== 'Overdue' && invoice.paymentStatus !== 'Paid' && invoice.paidAmount === 0) {
                    await Sale.findByIdAndUpdate(invoice._id, { paymentStatus: 'Overdue' });
                }
            }
        }

        console.log('✅ Daily Payment Reminder Cron Job Completed.');
    } catch (error) {
        console.error('❌ Cron job error:', error.message);
    }
};
