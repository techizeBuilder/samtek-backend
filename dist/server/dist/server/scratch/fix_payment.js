"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');
// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin';
// Import Models directly using require since this is a cjs script
const LeadPayment = require('../models/LeadPayment.js').default;
const Lead = require('../models/Lead.js').default;
const { Account } = require('../models/Account.js');
const LedgerEntry = require('../models/LedgerEntry.js').default;
const createAccountingEntries = (leadPayment, bankAccount) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const lineItems = [];
        // Debit Entry - Bank/Cash Account (Asset increases)
        if (bankAccount) {
            lineItems.push({
                accountType: 'Bank',
                accountId: bankAccount._id,
                accountName: `${((_a = bankAccount.bankDetails) === null || _a === void 0 ? void 0 : _a.bankName) || 'Bank'} - ${bankAccount.accountName}`,
                debitAmount: leadPayment.amount,
                creditAmount: 0,
                description: `Advanced payment received from ${leadPayment.companyName}`
            });
            // Update bank account balance
            bankAccount.balance += leadPayment.amount;
            yield bankAccount.save();
            console.log(`Updated bank account balance for ${bankAccount.accountName} by +₹${leadPayment.amount}`);
        }
        else {
            lineItems.push({
                accountType: 'Cash',
                accountId: new mongoose.Types.ObjectId(),
                accountName: 'Cash in Hand',
                debitAmount: leadPayment.amount,
                creditAmount: 0,
                description: `Cash received from ${leadPayment.companyName}`
            });
        }
        // Credit Entry - Advance from Customers (Liability increases)
        lineItems.push({
            accountType: 'Liability',
            accountId: leadPayment.leadId,
            accountName: `Advance from ${leadPayment.companyName}`,
            debitAmount: 0,
            creditAmount: leadPayment.amount,
            description: `Advanced payment for Lead ${leadPayment.leadCode}`
        });
        const count = yield LedgerEntry.countDocuments({ companyId: leadPayment.companyId });
        const entryNumber = `LE-${String(count + 1).padStart(6, '0')}`;
        // Create ledger entry
        const ledgerEntry = new LedgerEntry({
            entryNumber, // set manually to bypass mongoose pre-save validation conflict
            entryType: 'Receipt',
            referenceType: 'Lead Payment',
            referenceId: leadPayment._id,
            referenceNumber: leadPayment.leadCode,
            description: `Advanced payment received from ${leadPayment.companyName} for Lead ${leadPayment.leadCode}`,
            totalAmount: leadPayment.amount,
            lineItems,
            companyId: leadPayment.companyId,
            createdBy: leadPayment.addedBy,
            approvedBy: leadPayment.addedBy,
            approvedDate: new Date()
        });
        yield ledgerEntry.save();
        console.log(`Successfully created LedgerEntry ${entryNumber} for Lead Payment: ${leadPayment._id}`);
    }
    catch (err) {
        console.error('Error creating accounting entries:', err);
    }
});
const run = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('Connecting to database...');
        yield mongoose.connect(MONGODB_URI);
        console.log('Connected successfully!');
        // Find the specific lead payment for Sanjay Pandey (LD-0004) to make sure we process it!
        // Since it was marked Verified but its ledger failed, we can process all lead payments for LD-0004 that do not have a ledger entry yet!
        const payments = yield LeadPayment.find({ leadCode: 'LD-0004' });
        console.log(`Found ${payments.length} payments for LD-0004.`);
        for (const payment of payments) {
            console.log(`\nProcessing payment ${payment._id} for Lead ${payment.leadCode} (${payment.companyName}) - Amount: ₹${payment.amount}`);
            // Update status to Verified
            payment.status = 'Verified';
            payment.verifiedDate = new Date();
            // Load bank account
            let bankAccount = null;
            if (payment.bankAccount) {
                bankAccount = yield Account.findById(payment.bankAccount);
            }
            // Check if LedgerEntry already exists
            const existingLedger = yield LedgerEntry.findOne({ referenceId: payment._id });
            if (!existingLedger) {
                console.log('No existing ledger entry found. Creating one now...');
                yield createAccountingEntries(payment, bankAccount);
            }
            else {
                console.log('Ledger entry already exists for this payment. Skipping ledger creation.');
            }
            yield payment.save();
            console.log(`Updated payment status to Verified.`);
            // Update lead
            const lead = yield Lead.findById(payment.leadId);
            if (lead) {
                // Recalculate advancedPaymentAmount based on all verified payments
                const verifiedPayments = yield LeadPayment.find({
                    leadId: lead._id,
                    status: 'Verified'
                });
                const totalAdvanced = verifiedPayments.reduce((sum, p) => sum + p.amount, 0);
                lead.advancedPaymentAmount = totalAdvanced;
                console.log(`Recalculated Lead advancedPaymentAmount to: ₹${totalAdvanced}`);
                // Update paymentCheckStatus if Pending
                if (lead.paymentCheckStatus === 'Pending' || lead.paymentCheckStatus === 'Rejected' || lead.paymentCheckStatus === 'Not Requested') {
                    lead.paymentCheckStatus = lead.advancedPaymentAmount >= (lead.dealValue || 0) ? 'Paid' : 'Partially Paid';
                    console.log(`Auto-updated Lead paymentCheckStatus to: ${lead.paymentCheckStatus}`);
                    lead.history.push({
                        action: 'Payment Check Updated',
                        notes: `Payment check status auto-updated to '${lead.paymentCheckStatus}' by DB fix script.`,
                        performedBy: payment.addedBy
                    });
                }
                lead.history.push({
                    action: 'Advanced Payment Verified',
                    notes: `Advanced payment of ₹${payment.amount} verified and updated.`,
                    performedBy: payment.addedBy
                });
                yield lead.save();
                console.log(`Saved Lead ${lead.leadCode} successfully!`);
            }
        }
        console.log('\nProcessing completed.');
        mongoose.connection.close();
    }
    catch (error) {
        console.error('Error running fix script:', error);
        mongoose.connection.close();
    }
});
run();
