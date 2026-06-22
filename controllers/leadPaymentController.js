import LeadPayment from '../models/LeadPayment.js';
import Lead from '../models/Lead.js';
import { Account, Transaction } from '../models/Account.js';
import notificationService from '../services/notificationService.js';

// Get all leads sent to account for payment processing
export const getLeadsForPayment = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    
    const leads = await Lead.find({
      companyId,
      sentToAccount: true,
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

    if (!lead.sentToAccount) {
      return res.status(400).json({ success: false, message: 'Lead not sent to account yet' });
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

    // Build bank account label for display
    const bankAccountName = selectedBankAccount
      ? `${selectedBankAccount.bankDetails?.bankName ? selectedBankAccount.bankDetails.bankName + ' - ' : ''}${selectedBankAccount.accountName}`
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

/**
 * Create a Transaction entry in the double-entry ledger system.
 * bankAccount here is an Account model object (isBankOrCash: true).
 */
const createLedgerTransaction = async (leadPayment, bankAccount, user) => {
  const LedgerEntry = (await import('../models/LedgerEntry.js')).default;

  const unit = user.unit;
  if (!unit) {
    console.log('⚠️ User has no unit — skipping ledger entry');
    return;
  }

  // ------- 1. Resolve the main Bank/Cash Account -------
  let mainAccount = null;

  if (bankAccount) {
    // bankAccount is already an Account model object — use it directly
    mainAccount = bankAccount;
  } else {
    // Cash — find or create
    mainAccount = await Account.findOne({ unit, isBankOrCash: true, accountName: /cash/i });

    if (!mainAccount) {
    const accountNumber = `CASH-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      mainAccount = new Account({
        accountNumber,
        accountName: 'Cash in Hand',
        accountType: 'Asset',
        isBankOrCash: true,
        balance: 0,
        unit
      });
      await mainAccount.save();
      console.log(`✅ Created Cash Account in ledger`);
    }
  }

  // ------- 2. Find or create the "Advance from Customers" liability account -------
  let advanceAccount = await Account.findOne({ unit, accountName: 'Advance from Customers' });

  if (!advanceAccount) {
    const accountNumber = `ADV-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    advanceAccount = new Account({
      accountNumber,
      accountName: 'Advance from Customers',
      accountType: 'Liability',
      balance: 0,
      unit
    });
    await advanceAccount.save();
    console.log(`✅ Created Advance from Customers account`);
  }

  // ------- 3. Create Transaction (shown in Ledger Record page) -------
  const modeMap = { 'Cash': 'Cash', 'Bank Transfer': 'Bank Transfer', 'Cheque': 'Cheque', 'UPI': 'UPI', 'NEFT': 'NEFT' };
  const txn = new Transaction({
    transactionNumber: `TXN-LDP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    date: leadPayment.paymentDate || new Date(),
    description: `Advanced payment received from ${leadPayment.companyName} for Lead ${leadPayment.leadCode}`,
    reference: leadPayment.leadCode,
    totalAmount: leadPayment.amount,
    unit,
    relatedDocument: 'Receipt',
    relatedDocumentId: leadPayment._id,
    mode: modeMap[leadPayment.paymentMethod] || 'Other',
    createdBy: user._id,
    isApproved: true,
    approvedBy: user._id,
    entries: [
      // Debit Bank/Cash (money came in)
      { account: mainAccount._id, debit: leadPayment.amount, credit: 0 },
      // Credit Advance from Customers (liability)
      { account: advanceAccount._id, debit: 0, credit: leadPayment.amount }
    ]
  });
  await txn.save();

  // ------- 4. Update Account balances (reflects in Bank & Cash page + Ledger) -------
  mainAccount.balance = (mainAccount.balance || 0) + leadPayment.amount;
  await mainAccount.save();
  console.log(`✅ Account balance updated: ${mainAccount.accountName} → ₹${mainAccount.balance}`);

  advanceAccount.balance = (advanceAccount.balance || 0) + leadPayment.amount;
  await advanceAccount.save();

  // ------- 5. Create LedgerEntry record -------
  const ledgerEntry = new LedgerEntry({
    entryType: 'Receipt',
    referenceType: 'Lead Payment',
    referenceId: leadPayment._id,
    referenceNumber: leadPayment.leadCode,
    description: `Advanced payment received from ${leadPayment.companyName} for Lead ${leadPayment.leadCode}`,
    totalAmount: leadPayment.amount,
    lineItems: [
      {
        accountType: bankAccount ? 'Bank' : 'Cash',
        accountId: mainAccount._id,
        accountName: mainAccount.accountName,
        debitAmount: leadPayment.amount,
        creditAmount: 0,
        description: `Advanced payment received from ${leadPayment.companyName}`
      },
      {
        accountType: 'Liability',
        accountId: advanceAccount._id,
        accountName: `Advance from ${leadPayment.companyName}`,
        debitAmount: 0,
        creditAmount: leadPayment.amount,
        description: `Advanced payment for Lead ${leadPayment.leadCode}`
      }
    ],
    companyId: leadPayment.companyId,
    createdBy: user._id,
    approvedBy: user._id,
    approvedDate: new Date()
  });
  await ledgerEntry.save();

  console.log(`✅ Ledger entry created for Lead Payment: ${leadPayment._id}`);
  return ledgerEntry;
};

// Get all lead payments
export const getLeadPayments = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { leadId, status } = req.query;

    const query = { companyId };
    if (leadId) query.leadId = leadId;
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

// Get bank accounts for the Add Payment dropdown
// Uses the same Account model that Bank & Cash page uses
export const getBankAccounts = async (req, res) => {
  try {
    const unit = req.user.unit;

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
      balance: acc.balance || 0
    }));

    res.json({ success: true, bankAccounts });
  } catch (error) {
    console.error('Error fetching bank accounts:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};
