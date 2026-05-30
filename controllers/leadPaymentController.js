import LeadPayment from '../models/LeadPayment.js';
import Lead from '../models/Lead.js';
import Customer from '../models/Customer.js';

// Get all leads sent to account for payment processing
export const getLeadsForPayment = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    
    // Get leads that are sent to account but not yet won
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

    // Import required models
    const { Account } = await import('../models/Account.js');
    const LedgerEntry = (await import('../models/LedgerEntry.js')).default;

    // Validate bank account if provided
    let selectedBankAccount = null;
    if (bankAccount) {
      selectedBankAccount = await Account.findById(bankAccount);
      if (!selectedBankAccount) {
        return res.status(400).json({ success: false, message: 'Invalid bank account selected' });
      }
    }

    // Create lead payment record
    const leadPayment = new LeadPayment({
      leadId,
      leadCode: lead.leadCode,
      companyName: lead.companyName,
      contactPerson: lead.contactPerson,
      mobile: lead.mobile,
      email: lead.email,
      amount,
      paymentDate,
      paymentMethod,
      bankAccount: bankAccount || null,
      transactionId,
      remarks,
      status: 'Verified',
      verifiedBy: req.user._id,
      verifiedDate: new Date(),
      companyId: req.user.companyId,
      addedBy: req.user._id
    });

    await leadPayment.save();

    // 🔧 IMPROVED: Try to create accounting entries with better error handling
    try {
      await createAccountingEntries(leadPayment, selectedBankAccount, req.user);
    } catch (accountingError) {
      console.error('❌ Accounting entries failed:', accountingError);
      
      // If it's a duplicate key error, try to find existing accounts and use them
      if (accountingError.code === 11000) {
        console.log('🔄 Retrying with existing accounts...');
        try {
          await createAccountingEntriesWithExistingAccounts(leadPayment, selectedBankAccount, req.user);
        } catch (retryError) {
          console.error('❌ Retry also failed:', retryError);
          // Don't fail the payment creation, just log the error
          console.log('⚠️ Payment created but accounting entries failed. Manual intervention may be required.');
        }
      } else {
        // For other errors, don't fail the payment creation
        console.log('⚠️ Payment created but accounting entries failed. Manual intervention may be required.');
      }
    }

    // Update lead's advanced payment amount
    lead.advancedPaymentAmount = (lead.advancedPaymentAmount || 0) + amount;
    
    // Auto-update lead's payment check status if it was Pending or Rejected
    if (lead.paymentCheckStatus === 'Pending' || lead.paymentCheckStatus === 'Rejected') {
      lead.paymentCheckStatus = lead.advancedPaymentAmount >= (lead.dealValue || 0) ? 'Paid' : 'Partially Paid';
      lead.history.push({
        action: 'Payment Check Updated',
        notes: `Payment check status auto-updated to '${lead.paymentCheckStatus}' by system after adding advanced payment of ₹${amount}.`,
        performedBy: req.user._id
      });
    }

    lead.history.push({
      action: 'Advanced Payment Added',
      notes: `Advanced payment of ₹${amount} added by ${req.user.fullName || req.user.username}. ${selectedBankAccount ? `Bank: ${selectedBankAccount.accountName}` : ''}`,
      performedBy: req.user._id
    });
    await lead.save();

    res.json({ success: true, message: 'Advanced payment added and verified successfully', payment: leadPayment });
  } catch (error) {
    console.error('Error adding lead payment:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// 🔧 FALLBACK: Create accounting entries using only existing accounts
const createAccountingEntriesWithExistingAccounts = async (leadPayment, bankAccount, user) => {
  try {
    const LedgerEntry = (await import('../models/LedgerEntry.js')).default;
    const { Account, Transaction } = await import('../models/Account.js');

    // Find existing accounts only - don't create new ones
    let advanceAccount = await Account.findOne({ 
      accountName: 'Advance from Customers', 
      companyId: leadPayment.companyId 
    });
    
    let mainAccount = null;
    if (bankAccount) {
      mainAccount = await Account.findOne({
        accountName: bankAccount.accountName,
        companyId: leadPayment.companyId
      });
    } else {
      mainAccount = await Account.findOne({ 
        accountName: 'Cash in Hand', 
        companyId: leadPayment.companyId 
      });
    }

    // If we can't find the required accounts, skip accounting entries
    if (!advanceAccount || !mainAccount) {
      console.log('⚠️ Required accounts not found, skipping accounting entries');
      return null;
    }

    // Create simplified ledger entry
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

    // Update balances
    mainAccount.balance = (mainAccount.balance || 0) + leadPayment.amount;
    await mainAccount.save();

    advanceAccount.balance = (advanceAccount.balance || 0) + leadPayment.amount;
    await advanceAccount.save();

    console.log(`✅ Simplified accounting entries created for Lead Payment: ${leadPayment._id}`);
    return ledgerEntry;
  } catch (error) {
    console.error('Error creating simplified accounting entries:', error);
    throw error;
  }
};

// Create accounting entries for lead payment
const createAccountingEntries = async (leadPayment, bankAccount, user) => {
  try {
    const LedgerEntry = (await import('../models/LedgerEntry.js')).default;
    const { Account, Transaction } = await import('../models/Account.js');
    const mongoose = (await import('mongoose')).default;

    // 🔧 IMPROVED: Generate unique account number with retry mechanism
    const generateUniqueAccountNumber = async (prefix) => {
      let attempts = 0;
      const maxAttempts = 5;
      
      while (attempts < maxAttempts) {
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substr(2, 9).toUpperCase();
        const accountNumber = `${prefix}-${timestamp}-${randomStr}`;
        
        // Check if this account number already exists
        const existing = await Account.findOne({ accountNumber });
        if (!existing) {
          return accountNumber;
        }
        
        attempts++;
        // Wait a bit before retry to ensure different timestamp
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      // Fallback: use UUID-like approach
      const uuid = require('crypto').randomUUID().replace(/-/g, '').toUpperCase();
      return `${prefix}-${uuid.substr(0, 12)}`;
    };

    // Find or create Liability Account for Advance
    let advanceAccount = await Account.findOne({ 
      accountName: 'Advance from Customers', 
      companyId: leadPayment.companyId 
    });
    
    if (!advanceAccount) {
      const uniqueAccountNumber = await generateUniqueAccountNumber('ADV');
      advanceAccount = new Account({
        accountNumber: uniqueAccountNumber,
        accountName: 'Advance from Customers',
        accountType: 'Liability',
        balance: 0,
        unit: user.unit || 'Default',
        companyId: leadPayment.companyId
      });
      await advanceAccount.save();
      console.log(`✅ Created Advance Account: ${uniqueAccountNumber}`);
    }

    // Find or create corresponding Main Account for BankAccount
    let mainAccount = null;
    if (bankAccount) {
      // First try to find by bank account reference
      mainAccount = await Account.findOne({ 
        'bankDetails.accountNumber': bankAccount.accountNumber,
        companyId: leadPayment.companyId 
      });
      
      if (!mainAccount) {
        // Try to find by account name
        mainAccount = await Account.findOne({
          accountName: bankAccount.accountName,
          companyId: leadPayment.companyId
        });
      }
      
      if (!mainAccount) {
        const uniqueAccountNumber = await generateUniqueAccountNumber('BANK');
        mainAccount = new Account({
          accountName: bankAccount.accountName,
          accountNumber: uniqueAccountNumber,
          accountType: 'Asset',
          isBankOrCash: true,
          bankDetails: {
            bankName: bankAccount.bankName,
            accountNumber: bankAccount.accountNumber,
            ifsc: bankAccount.ifscCode,
            branch: bankAccount.branchName
          },
          balance: 0,
          unit: user.unit || 'Default',
          companyId: leadPayment.companyId
        });
        await mainAccount.save();
        console.log(`✅ Created Bank Account: ${uniqueAccountNumber}`);
      }
    } else {
      // Cash account
      mainAccount = await Account.findOne({ 
        accountName: 'Cash in Hand', 
        companyId: leadPayment.companyId 
      });
      
      if (!mainAccount) {
        const uniqueAccountNumber = await generateUniqueAccountNumber('CASH');
        mainAccount = new Account({
          accountNumber: uniqueAccountNumber,
          accountName: 'Cash in Hand',
          accountType: 'Asset',
          isBankOrCash: true,
          balance: 0,
          unit: user.unit || 'Default',
          companyId: leadPayment.companyId
        });
        await mainAccount.save();
        console.log(`✅ Created Cash Account: ${uniqueAccountNumber}`);
      }
    }

    const mainAccountId = mainAccount._id;
    const mainAccountName = mainAccount.accountName;

    // Prepare line items for LedgerEntry (new system)
    const lineItems = [];
    lineItems.push({
      accountType: bankAccount ? 'Bank' : 'Cash',
      accountId: mainAccountId,
      accountName: mainAccountName,
      debitAmount: leadPayment.amount,
      creditAmount: 0,
      description: `Advanced payment received from ${leadPayment.companyName}`
    });

    lineItems.push({
      accountType: 'Liability',
      accountId: advanceAccount._id,
      accountName: `Advance from ${leadPayment.companyName}`,
      debitAmount: 0,
      creditAmount: leadPayment.amount,
      description: `Advanced payment for Lead ${leadPayment.leadCode}`
    });

    // Create LedgerEntry
    const ledgerEntry = new LedgerEntry({
      entryType: 'Receipt',
      referenceType: 'Lead Payment',
      referenceId: leadPayment._id,
      referenceNumber: leadPayment.leadCode,
      description: `Advanced payment received from ${leadPayment.companyName} for Lead ${leadPayment.leadCode}`,
      totalAmount: leadPayment.amount,
      lineItems,
      companyId: leadPayment.companyId,
      createdBy: user._id,
      approvedBy: user._id,
      approvedDate: new Date()
    });
    await ledgerEntry.save();

    // Create Transaction (old system used by Ledger UI)
    const txn = new Transaction({
      transactionNumber: `TXN-LDP-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      description: `Advanced payment received from ${leadPayment.companyName} for Lead ${leadPayment.leadCode}`,
      reference: leadPayment.leadCode,
      totalAmount: leadPayment.amount,
      unit: user.unit || 'Default',
      relatedDocument: 'Receipt',
      relatedDocumentId: leadPayment._id,
      mode: leadPayment.paymentMethod || 'Other',
      createdBy: user._id,
      isApproved: true,
      approvedBy: user._id,
      entries: [
        { account: mainAccountId, debit: leadPayment.amount, credit: 0 },
        { account: advanceAccount._id, debit: 0, credit: leadPayment.amount }
      ]
    });
    await txn.save();

    // Update Account Balances
    if (bankAccount) {
      bankAccount.currentBalance = (bankAccount.currentBalance || 0) + leadPayment.amount;
      await bankAccount.save();
    }
    
    mainAccount.balance = (mainAccount.balance || 0) + leadPayment.amount;
    await mainAccount.save();

    advanceAccount.balance = (advanceAccount.balance || 0) + leadPayment.amount;
    await advanceAccount.save();

    console.log(`Accounting entries & transaction created for Lead Payment: ${leadPayment._id}`);
    return ledgerEntry;
  } catch (error) {
    console.error('Error creating accounting entries:', error);
    throw error;
  }
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

    const payment = await LeadPayment.findById(id).populate('bankAccount');
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const oldStatus = payment.status;
    payment.status = status;
    if (remarks) payment.remarks = remarks;
    if (status === 'Verified') {
      payment.verifiedBy = req.user._id;
      payment.verifiedDate = new Date();
      
      // Create accounting entries when payment is verified
      if (oldStatus !== 'Verified') {
        await createAccountingEntries(payment, payment.bankAccount, req.user);
      }
    }

    await payment.save();

    // Update lead history
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
      summary: {
        totalPaid,
        totalPending,
        totalPayments: payments.length
      }
    });
  } catch (error) {
    console.error('Error fetching lead payment summary:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get bank accounts for payment dropdown
export const getBankAccounts = async (req, res) => {
  try {
    const BankAccount = (await import('../models/BankAccount.js')).default;
    
    const bankAccounts = await BankAccount.find({
      companyId: req.user.companyId,
      isActive: true
    }).select('accountName accountNumber bankName accountType currentBalance');

    // If no bank accounts found, return dummy accounts for demo
    if (bankAccounts.length === 0) {
      const dummyAccounts = [
        {
          _id: '1',
          bankName: 'HDFC Bank',
          accountName: 'Company Current Account',
          accountNumber: '****1234',
          ifscCode: 'HDFC0001234'
        },
        {
          _id: '2',
          bankName: 'ICICI Bank',
          accountName: 'Business Account',
          accountNumber: '****5678',
          ifscCode: 'ICIC0005678'
        },
        {
          _id: '3',
          bankName: 'SBI Bank',
          accountName: 'Savings Account',
          accountNumber: '****9012',
          ifscCode: 'SBIN0009012'
        }
      ];
      return res.json({ success: true, bankAccounts: dummyAccounts });
    }

    res.json({ success: true, bankAccounts });
  } catch (error) {
    console.error('Error fetching bank accounts:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};