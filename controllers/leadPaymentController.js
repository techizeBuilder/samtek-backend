import LeadPayment from '../models/LeadPayment.js';
import Lead from '../models/Lead.js';
import { Account } from '../models/Account.js';
import notificationService from '../services/notificationService.js';
import { createLedgerTransaction } from '../utils/leadPaymentLedger.js';

// Get all leads sent to account for payment processing
export const getLeadsForPayment = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    
    const leads = await Lead.find({
      companyId,
      status: { $ne: 'Won' }
    })
    .populate('assignedTo', 'fullName username')
    .sort({ sentToAccountDate: -1 });

    res.json({ success: true, leads });
  } catch (error) {
    console.error('Error fetching leads for payment:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Add advanced payment for a lead
export const addLeadPayment = async (req, res) => {
  try {
    const { leadId, amount, paymentDate, paymentMethod, bankAccount, transactionId, remarks } = req.body;
    
    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    // Validate and fetch bank account if provided
    // Bank accounts live in the Account model (same as Bank & Cash page)
    let selectedBankAccount = null;
    if (bankAccount) {
      selectedBankAccount = await Account.findOne({
        _id: bankAccount,
        unit: req.user.unit,
        isBankOrCash: true
      });
      if (!selectedBankAccount) {
        return res.status(400).json({ success: false, message: 'Invalid bank account selected' });
      }
    }

    // Build bank account label for display — includes the account number so
    // same-named accounts stay distinguishable wherever this label is shown.
    const bankAccountName = selectedBankAccount
      ? `${selectedBankAccount.bankDetails?.bankName ? selectedBankAccount.bankDetails.bankName + ' - ' : ''}${selectedBankAccount.accountName} (${selectedBankAccount.accountNumber})`
      : null;

    // Create lead payment record
    const leadPayment = new LeadPayment({
      leadId,
      leadCode: lead.leadCode,
      companyName: lead.companyName,
      contactPerson: lead.contactPerson,
      mobile: lead.mobile,
      email: lead.email,
      amount: parseFloat(amount),
      paymentDate,
      paymentMethod,
      bankAccount: selectedBankAccount ? selectedBankAccount._id : null,
      bankAccountName,
      transactionId,
      remarks,
      status: 'Verified',
      verifiedBy: req.user._id,
      verifiedDate: new Date(),
      companyId: req.user.companyId,
      addedBy: req.user._id
    });

    await leadPayment.save();

    // Create accounting entries in the Transaction/Account (Ledger) system
    // This also updates the Account balance so Bank & Cash page reflects correctly
    try {
      await createLedgerTransaction(leadPayment, selectedBankAccount, req.user);
    } catch (ledgerError) {
      console.error('⚠️ Ledger transaction creation failed (payment still saved):', ledgerError.message);
    }

    // Update lead's advanced payment amount
    lead.advancedPaymentAmount = (lead.advancedPaymentAmount || 0) + parseFloat(amount);
    
    lead.history.push({
      action: 'Advanced Payment Added',
      notes: `Advanced payment of ₹${amount} added by ${req.user.fullName || req.user.username}. ${bankAccountName ? `Bank: ${bankAccountName}` : 'Cash payment.'}`,
      performedBy: req.user._id
    });
    await lead.save();

    res.json({ 
      success: true, 
      message: 'Advanced payment added and verified successfully', 
      payment: leadPayment 
    });

    // 🔔 Notify Sales that payment was added
    try {
      await notificationService.triggerAccountsNotification({
        action: 'lead_payment_added',
        data: { 
          leadCode: lead.leadCode, 
          leadId: lead._id, 
          amount: leadPayment.amount,
          assignedTo: lead.assignedTo,
          status: lead.paymentCheckStatus
        },
        targetCompanyId: req.user.companyId,
      });
    } catch (e) { console.error('Lead payment added notification error:', e); }
  } catch (error) {
    console.error('Error adding lead payment:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// createLedgerTransaction moved to ../utils/leadPaymentLedger.js — shared with
// leadController.updatePaymentCheckStatus, which now also verifies a
// Sales-submitted LeadPayment (see the payment-check merge, 2026-09).

// Get all lead payments
export const getLeadPayments = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { leadId, leadIds, status } = req.query;

    const query = { companyId };
    if (leadId) query.leadId = leadId;
    // `leadIds` (comma-separated) — used by Payment Verifications to scope
    // this fetch down to just the leads on the current paginated page,
    // instead of pulling every payment record the company has ever had.
    if (leadIds) query.leadId = { $in: leadIds.split(',') };
    if (status) query.status = status;

    const payments = await LeadPayment.find(query)
      .populate('leadId', 'leadCode companyName contactPerson')
      .populate('addedBy', 'fullName username')
      .populate('verifiedBy', 'fullName username')
      .sort({ createdAt: -1 });

    res.json({ success: true, payments });
  } catch (error) {
    console.error('Error fetching lead payments:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Verify/Update lead payment status
export const updateLeadPaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks } = req.body;

    const payment = await LeadPayment.findById(id);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const oldStatus = payment.status;
    payment.status = status;
    if (remarks) payment.remarks = remarks;

    if (status === 'Verified' && oldStatus !== 'Verified') {
      payment.verifiedBy = req.user._id;
      payment.verifiedDate = new Date();

      // Create ledger entries when payment is newly verified
      // Fetch the Account object for the bank
      let bankAccountObj = null;
      if (payment.bankAccount) {
        bankAccountObj = await Account.findById(payment.bankAccount);
      }
      try {
        await createLedgerTransaction(payment, bankAccountObj, req.user);
      } catch (err) {
        console.error('⚠️ Ledger entry failed on verify:', err.message);
      }
    }

    await payment.save();

    const lead = await Lead.findById(payment.leadId);
    if (lead) {
      lead.history.push({
        action: 'Advanced Payment Status Updated',
        notes: `Payment status updated to ${status}. Amount: ₹${payment.amount}. ${remarks ? `Remarks: ${remarks}` : ''}`,
        performedBy: req.user._id
      });
      await lead.save();
    }

    res.json({ success: true, message: 'Payment status updated successfully', payment });
  } catch (error) {
    console.error('Error updating payment status:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get payment summary for a specific lead
export const getLeadPaymentSummary = async (req, res) => {
  try {
    const { leadId } = req.params;
    
    const payments = await LeadPayment.find({ leadId })
      .populate('addedBy', 'fullName username')
      .populate('verifiedBy', 'fullName username')
      .sort({ createdAt: -1 });

    const totalPaid = payments
      .filter(p => p.status === 'Verified')
      .reduce((sum, p) => sum + p.amount, 0);

    const totalPending = payments
      .filter(p => p.status === 'Pending')
      .reduce((sum, p) => sum + p.amount, 0);

    res.json({ 
      success: true, 
      payments,
      summary: { totalPaid, totalPending, totalPayments: payments.length }
    });
  } catch (error) {
    console.error('Error fetching lead payment summary:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Bank/Cash account picker for the payment form — used by both Accounts
// (Bank & Cash page context) and, since the payment-check merge, Sales (Check
// Payment modal). Uses the same Account model that Bank & Cash page uses.
const ACCOUNTS_ROLES = ['Accounts', 'Accounts Head', 'Account Employee', 'Finance Manager'];

export const getBankAccounts = async (req, res) => {
  try {
    const unit = req.user.unit;
    // Only Accounts roles get to see the live balance — Sales just needs
    // enough to pick the right account, never the money in it.
    const isAccountsRole = ACCOUNTS_ROLES.includes(req.user.role) || req.user.role === 'Super Admin';

    const accounts = await Account.find({
      unit,
      isBankOrCash: true,
      isActive: true
    }).select('accountName accountNumber bankDetails balance');

    const bankAccounts = accounts.map(acc => ({
      _id: acc._id,
      accountName: acc.accountName,
      accountNumber: acc.accountNumber,
      bankName: acc.bankDetails?.bankName || '',
      ...(isAccountsRole ? { balance: acc.balance || 0 } : {})
    }));

    res.json({ success: true, bankAccounts });
  } catch (error) {
    console.error('Error fetching bank accounts:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};
