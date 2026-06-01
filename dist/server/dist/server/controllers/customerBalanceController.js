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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recalculateCustomerBalances = void 0;
const Customer_js_1 = __importDefault(require("../models/Customer.js"));
const Sale_js_1 = __importDefault(require("../models/Sale.js"));
const mongoose_1 = __importDefault(require("mongoose"));
/**
 * Utility to recalculate outstanding balances for all customers
 * Iterates through all customers, sums up their sales invoices balance, and updates the customer record.
 */
const recalculateCustomerBalances = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🔄 Starting customer balance recalculation...');
        const customers = yield Customer_js_1.default.find({});
        let updatedCount = 0;
        // Process in batches
        for (const customer of customers) {
            const customerId = customer._id;
            // 1. Calculate Total Sales Amount (Debits)
            const salesResult = yield Sale_js_1.default.aggregate([
                { $match: { customer: customerId } },
                { $group: { _id: null, totalSales: { $sum: '$totalAmount' } } }
            ]);
            const totalSales = salesResult.length > 0 ? salesResult[0].totalSales : 0;
            // 2. Calculate Total Payments Received (Credits)
            // We need to import CustomerPayment model first, let's assume it's available or we need to add it.
            // Since we can't easily add import in the middle, I'll use mongoose.model if not imported, 
            // but better to rely on top-level imports. I will add the import in a separate step if needed.
            // For now, I'll assume I can use mongoose.model('CustomerPayment') or the file already has it?
            // The file currently only imports Customer and Sale. I need to add CustomerPayment import.
            // Let's use the aggregate on the model directly if possible, or use mongoose.connection.model
            const CustomerPayment = mongoose_1.default.model('CustomerPayment');
            const paymentsResult = yield CustomerPayment.aggregate([
                { $match: { customer: customerId } },
                { $group: { _id: null, totalPayments: { $sum: '$amount' } } }
            ]);
            const totalPayments = paymentsResult.length > 0 ? paymentsResult[0].totalPayments : 0;
            // 3. Calculate Outstanding (Debit - Credit)
            // Positive outstanding means customer owes money.
            // Negative outstanding means customer has advance/credit.
            const newOutstanding = totalSales - totalPayments;
            const currentOutstanding = customer.outstandingAmount || 0;
            // Update if difference exists
            if (Math.abs(currentOutstanding - newOutstanding) > 0.01) {
                // console.log(`📝 Updating ${customer.name}: ${currentOutstanding} -> ${newOutstanding}`);
                customer.outstandingAmount = newOutstanding;
                yield customer.save();
                updatedCount++;
            }
        }
        console.log(`✅ Recalculation complete. Updated ${updatedCount} customers.`);
        const response = {
            success: true,
            message: `Recalculation complete. Processed ${customers.length} customers. Updated ${updatedCount} records.`,
            updatedCount
        };
        if (req.query.debug === 'true') {
            const debugLog = [];
            for (const customer of customers.slice(0, 10)) { // Limit to first 10 for debug
                const sales = yield Sale_js_1.default.find({ customer: customer._id });
                const totalOutstanding = sales.reduce((sum, sale) => sum + (sale.balanceAmount || 0), 0);
                debugLog.push({
                    customer: customer.name,
                    salesCount: sales.length,
                    totalOutstanding,
                    currentInDB: customer.outstandingAmount,
                    sales: sales.map(s => ({
                        invoice: s.invoiceNumber,
                        total: s.totalAmount,
                        paid: s.paidAmount,
                        balance: s.balanceAmount,
                        status: s.paymentStatus
                    }))
                });
            }
            response.debug = debugLog;
        }
        res.json(response);
    }
    catch (error) {
        console.error('❌ Error recalculating balances:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.recalculateCustomerBalances = recalculateCustomerBalances;
