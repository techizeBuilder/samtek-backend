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
exports.getTaxSummary = void 0;
const Sale_js_1 = __importDefault(require("../models/Sale.js"));
const PurchaseInvoice_js_1 = __importDefault(require("../models/PurchaseInvoice.js"));
const Company_js_1 = require("../models/Company.js");
const mongoose_1 = __importDefault(require("mongoose"));
/**
 * Get GST & TDS Summary
 * Dynamically calculates CGST, SGST, IGST and aggregates data for reporting
 */
const getTaxSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const companyId = req.user.companyId;
        const moodYear = req.query.year;
        const moodMonth = req.query.month;
        console.log('📊 Fetching Tax Summary for Company:', companyId, { year: moodYear, month: moodMonth });
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'No company associated with user' });
        }
        const validCompanyId = new mongoose_1.default.Types.ObjectId(companyId);
        // Fetch Company to get its state for GST type calculation
        const company = yield Company_js_1.Company.findById(validCompanyId);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        const companyState = (company.state || '').toLowerCase().trim();
        // 1. Fetch Sales (Output Tax)
        let salesQuery = { companyId: validCompanyId };
        if (moodYear && moodMonth) {
            const startDate = new Date(parseInt(moodYear), parseInt(moodMonth) - 1, 1);
            const endDate = new Date(parseInt(moodYear), parseInt(moodMonth), 0, 23, 59, 59);
            salesQuery.saleDate = { $gte: startDate, $lte: endDate };
        }
        const sales = yield Sale_js_1.default.find(salesQuery).populate('customer', 'name state');
        console.log(`✅ Found ${sales.length} sales records`);
        // 2. Fetch Purchase Invoices (Input Tax)
        let purchaseQuery = { companyId: validCompanyId };
        if (moodYear && moodMonth) {
            const startDate = new Date(parseInt(moodYear), parseInt(moodMonth) - 1, 1);
            const endDate = new Date(parseInt(moodYear), parseInt(moodMonth), 0, 23, 59, 59);
            purchaseQuery.invoiceDate = { $gte: startDate, $lte: endDate };
        }
        const purchases = yield PurchaseInvoice_js_1.default.find(purchaseQuery).populate('vendor', 'supplierName address');
        console.log(`✅ Found ${purchases.length} purchase records`);
        // Aggregation logic
        let summary = {
            outputGST: { cgst: 0, sgst: 0, igst: 0, total: 0 },
            inputGST: { cgst: 0, sgst: 0, igst: 0, total: 0 },
            tdsReceivable: 0,
            tdsPayable: 0,
            netGSTLiability: 0,
            transactions: []
        };
        // Process Sales
        sales.forEach(inv => {
            var _a;
            const tax = Number(inv.taxAmount) || 0;
            const customerState = (((_a = inv.customer) === null || _a === void 0 ? void 0 : _a.state) || '').toLowerCase().trim();
            // Default to IGST if no state info, or check same-state
            const isSameState = customerState && companyState && (customerState === companyState);
            let type = 'IGST';
            if (isSameState) {
                type = 'CGST/SGST';
                summary.outputGST.cgst += tax / 2;
                summary.outputGST.sgst += tax / 2;
            }
            else {
                summary.outputGST.igst += tax;
            }
            summary.outputGST.total += tax;
            summary.tdsReceivable += Number(inv.tdsAmount) || 0;
            summary.transactions.push({
                id: inv._id,
                period: inv.saleDate ? new Date(inv.saleDate).toLocaleString('default', { month: 'short', year: 'numeric' }) : 'N/A',
                transactionType: 'Sales',
                invoiceNo: inv.invoiceNumber || 'N/A',
                taxType: type,
                gstAmount: tax,
                tdsAmount: Number(inv.tdsAmount) || 0,
                netAmount: (Number(inv.totalAmount) || 0) - (Number(inv.tdsAmount) || 0),
                status: inv.paymentStatus || 'Pending',
                date: inv.saleDate || inv.createdAt
            });
        });
        // Process Purchases
        purchases.forEach(inv => {
            var _a, _b, _c;
            const tax = Number(inv.gstAmount) || 0;
            const supplierState = (((_b = (_a = inv.vendor) === null || _a === void 0 ? void 0 : _a.address) === null || _b === void 0 ? void 0 : _b.state) || ((_c = inv.vendor) === null || _c === void 0 ? void 0 : _c.state) || '').toLowerCase().trim();
            const isSameState = supplierState && companyState && (supplierState === companyState);
            let type = 'IGST';
            if (isSameState) {
                type = 'CGST/SGST';
                summary.inputGST.cgst += tax / 2;
                summary.inputGST.sgst += tax / 2;
            }
            else {
                summary.inputGST.igst += tax;
            }
            summary.inputGST.total += tax;
            summary.tdsPayable += Number(inv.tdsAmount) || 0;
            summary.transactions.push({
                id: inv._id,
                period: inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleString('default', { month: 'short', year: 'numeric' }) : 'N/A',
                transactionType: 'Purchases',
                invoiceNo: inv.invoiceNo || 'N/A',
                taxType: type,
                gstAmount: tax,
                tdsAmount: Number(inv.tdsAmount) || 0,
                netAmount: (Number(inv.totalAmount) || 0) - (Number(inv.tdsAmount) || 0),
                status: inv.status || 'Pending',
                date: inv.invoiceDate || inv.createdAt
            });
        });
        summary.netGSTLiability = summary.outputGST.total - summary.inputGST.total;
        console.log('📊 Resulting Summary TDS:', { receivable: summary.tdsReceivable, payable: summary.tdsPayable });
        res.json({ success: true, data: summary });
    }
    catch (error) {
        console.error('❌ Error in getTaxSummary:', error);
        res.status(500).json({ success: false, message: 'Tax summary calculation failed', error: error.message });
    }
});
exports.getTaxSummary = getTaxSummary;
