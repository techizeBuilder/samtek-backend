import { Account, Transaction } from '../models/Account.js';

// Create a Transaction entry in the double-entry ledger system for a Lead
// Payment that has just been verified. bankAccount here is an Account model
// object (isBankOrCash: true) or null (Cash). Shared by
// leadPaymentController.updateLeadPaymentStatus (Accounts verifying via the
// /lead-payments/:id/status endpoint) and leadController.updatePaymentCheckStatus
// (Accounts verifying a Sales-submitted payment-check request) so the "only
// post on Pending -> Verified" invariant lives in exactly one place.
export const createLedgerTransaction = async (leadPayment, bankAccount, user) => {
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
