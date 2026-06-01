"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDailyReminderCron = exports.sendManualReminder = exports.getOverdueInvoices = exports.saveReminderSettings = exports.getReminderSettings = void 0;
const Sale_js_1 = __importDefault(require("../models/Sale.js"));
const Customer_js_1 = __importDefault(require("../models/Customer.js"));
const Company_js_1 = require("../models/Company.js");
const PaymentReminderSettings_js_1 = __importDefault(require("../models/PaymentReminderSettings.js"));
const emailService_js_1 = require("../services/emailService.js");
const mongoose_1 = __importDefault(require("mongoose"));
// ─── GET Settings ─────────────────────────────────────────────────────────────
const getReminderSettings = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const companyId = req.user.companyId;
        let settings = yield PaymentReminderSettings_js_1.default.findOne({ companyId });
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getReminderSettings = getReminderSettings;
// ─── SAVE / UPDATE Settings ───────────────────────────────────────────────────
const saveReminderSettings = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const companyId = req.user.companyId;
        const { firstReminderDays, secondReminderDays, overdueAfterDays, autoEmailEnabled, reminderFrequencyDays } = req.body;
        const settings = yield PaymentReminderSettings_js_1.default.findOneAndUpdate({ companyId }, { firstReminderDays, secondReminderDays, overdueAfterDays, autoEmailEnabled, reminderFrequencyDays }, { upsert: true, new: true });
        res.json({ success: true, data: settings, message: 'Settings saved successfully.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.saveReminderSettings = saveReminderSettings;
// ─── GET Overdue / Pending Invoices ──────────────────────────────────────────
const getOverdueInvoices = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const companyId = req.user.companyId;
        const settings = yield PaymentReminderSettings_js_1.default.findOne({ companyId });
        const overdueAfterDays = (settings === null || settings === void 0 ? void 0 : settings.overdueAfterDays) || 30;
        const today = new Date();
        // Fetch all unpaid / partial invoices
        const invoices = yield Sale_js_1.default.find({
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
            return Object.assign(Object.assign({}, inv), { daysOverdue: isOverdue ? daysFromDue : 0, daysFromInvoice,
                isOverdue, overdueLevel: daysFromDue > overdueAfterDays ? 'critical' : daysFromDue > 0 ? 'warning' : 'normal', balanceAmount: inv.totalAmount - (inv.paidAmount || 0) });
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getOverdueInvoices = getOverdueInvoices;
// ─── SEND Manual Reminder Email ───────────────────────────────────────────────
const sendManualReminder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { invoiceId } = req.body;
        const companyId = req.user.companyId;
        const invoice = yield Sale_js_1.default.findById(invoiceId).populate('customer', 'name email mobile');
        if (!invoice)
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        const company = yield Company_js_1.Company.findById(companyId);
        const customer = invoice.customer;
        if (!(customer === null || customer === void 0 ? void 0 : customer.email)) {
            return res.status(400).json({ success: false, message: `Customer "${customer === null || customer === void 0 ? void 0 : customer.name}" has no email on file.` });
        }
        const today = new Date();
        const dueDate = new Date(invoice.dueDate);
        const daysOverdue = Math.max(0, Math.floor((today - dueDate) / (1000 * 60 * 60 * 24)));
        const balanceAmount = invoice.totalAmount - (invoice.paidAmount || 0);
        const result = yield (0, emailService_js_1.sendPaymentReminderEmail)({
            to: customer.email,
            customerName: customer.name,
            invoiceNo: invoice.invoiceNumber,
            totalAmount: invoice.totalAmount,
            paidAmount: invoice.paidAmount || 0,
            balanceAmount,
            dueDate: invoice.dueDate,
            companyName: (company === null || company === void 0 ? void 0 : company.name) || (company === null || company === void 0 ? void 0 : company.unitName) || 'Samtek',
            daysOverdue
        });
        // Log the reminder in invoice
        yield Sale_js_1.default.findByIdAndUpdate(invoiceId, {
            $push: { reminderSentDates: { sentAt: new Date(), type: daysOverdue > 0 ? 'overdue' : 'first' } }
        });
        res.json({ success: true, message: `Reminder email sent to ${customer.email}`, result });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.sendManualReminder = sendManualReminder;
// ─── CRON JOB — Run Daily Auto Reminders ─────────────────────────────────────
const runDailyReminderCron = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        console.log('🕐 Running Daily Payment Reminder Cron Job...');
        const today = new Date();
        const msPerDay = 1000 * 60 * 60 * 24;
        // Get all companies with auto email enabled
        const allSettings = yield PaymentReminderSettings_js_1.default.find({ autoEmailEnabled: true });
        for (const settings of allSettings) {
            const companyId = settings.companyId;
            const company = yield Company_js_1.Company.findById(companyId);
            // Fetch unpaid invoices for this company
            const invoices = yield Sale_js_1.default.find({
                companyId,
                paymentStatus: { $in: ['Pending', 'Partially Paid', 'Overdue'] }
            }).populate('customer', 'name email state');
            for (const invoice of invoices) {
                const customer = invoice.customer;
                if (!(customer === null || customer === void 0 ? void 0 : customer.email))
                    continue;
                const dueDate = new Date(invoice.dueDate);
                const saleDate = new Date(invoice.saleDate);
                const daysFromInvoice = Math.floor((today - saleDate) / msPerDay);
                const daysFromDue = Math.floor((today - dueDate) / msPerDay);
                const balanceAmount = invoice.totalAmount - (invoice.paidAmount || 0);
                // Determine if reminder should be sent
                const alreadySentTypes = ((_a = invoice.reminderSentDates) === null || _a === void 0 ? void 0 : _a.map(r => r.type)) || [];
                let shouldSend = false;
                let reminderType = 'first';
                if (daysFromDue > 0 && !alreadySentTypes.includes('overdue')) {
                    // Overdue reminder
                    const lastOverdue = (_b = invoice.reminderSentDates) === null || _b === void 0 ? void 0 : _b.filter(r => r.type === 'overdue').pop();
                    const daysSinceLastOverdue = lastOverdue
                        ? Math.floor((today - new Date(lastOverdue.sentAt)) / msPerDay)
                        : settings.reminderFrequencyDays + 1;
                    if (daysSinceLastOverdue >= settings.reminderFrequencyDays) {
                        shouldSend = true;
                        reminderType = 'overdue';
                    }
                }
                else if (daysFromInvoice >= settings.secondReminderDays && !alreadySentTypes.includes('second')) {
                    shouldSend = true;
                    reminderType = 'second';
                }
                else if (daysFromInvoice >= settings.firstReminderDays && !alreadySentTypes.includes('first')) {
                    shouldSend = true;
                    reminderType = 'first';
                }
                if (shouldSend) {
                    yield (0, emailService_js_1.sendPaymentReminderEmail)({
                        to: customer.email,
                        customerName: customer.name,
                        invoiceNo: invoice.invoiceNumber,
                        totalAmount: invoice.totalAmount,
                        paidAmount: invoice.paidAmount || 0,
                        balanceAmount,
                        dueDate: invoice.dueDate,
                        companyName: (company === null || company === void 0 ? void 0 : company.name) || 'Samtek',
                        daysOverdue: Math.max(0, daysFromDue)
                    });
                    // Log reminder
                    yield Sale_js_1.default.findByIdAndUpdate(invoice._id, {
                        $push: { reminderSentDates: { sentAt: today, type: reminderType } }
                    });
                    console.log(`📧 Auto reminder (${reminderType}) sent to ${customer.email} for ${invoice.invoiceNumber}`);
                }
                // Auto update to Overdue if past due date
                if (daysFromDue > 0 && invoice.paymentStatus !== 'Overdue' && invoice.paymentStatus !== 'Paid' && invoice.paidAmount === 0) {
                    yield Sale_js_1.default.findByIdAndUpdate(invoice._id, { paymentStatus: 'Overdue' });
                }
            }
        }
        console.log('✅ Daily Payment Reminder Cron Job Completed.');
    }
    catch (error) {
        console.error('❌ Cron job error:', error.message);
    }
});
exports.runDailyReminderCron = runDailyReminderCron;
