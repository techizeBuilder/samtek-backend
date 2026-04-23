import Sale from '../models/Sale.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import { Company } from '../models/Company.js';
import mongoose from 'mongoose';

/**
 * Get GST & TDS Summary
 * Dynamically calculates CGST, SGST, IGST and aggregates data for reporting
 */
export const getTaxSummary = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const moodYear = req.query.year;
        const moodMonth = req.query.month;

        console.log('📊 Fetching Tax Summary for Company:', companyId, { year: moodYear, month: moodMonth });

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'No company associated with user' });
        }

        const validCompanyId = new mongoose.Types.ObjectId(companyId);

        // Fetch Company to get its state for GST type calculation
        const company = await Company.findById(validCompanyId);
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

        const sales = await Sale.find(salesQuery).populate('customer', 'name state');
        console.log(`✅ Found ${sales.length} sales records`);

        // 2. Fetch Purchase Invoices (Input Tax)
        let purchaseQuery = { companyId: validCompanyId };
        if (moodYear && moodMonth) {
            const startDate = new Date(parseInt(moodYear), parseInt(moodMonth) - 1, 1);
            const endDate = new Date(parseInt(moodYear), parseInt(moodMonth), 0, 23, 59, 59);
            purchaseQuery.invoiceDate = { $gte: startDate, $lte: endDate };
        }

        const purchases = await PurchaseInvoice.find(purchaseQuery).populate('vendor', 'supplierName address');
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
            const tax = Number(inv.taxAmount) || 0;
            const customerState = (inv.customer?.state || '').toLowerCase().trim();
            // Default to IGST if no state info, or check same-state
            const isSameState = customerState && companyState && (customerState === companyState);

            let type = 'IGST';
            if (isSameState) {
                type = 'CGST/SGST';
                summary.outputGST.cgst += tax / 2;
                summary.outputGST.sgst += tax / 2;
            } else {
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
            const tax = Number(inv.gstAmount) || 0;
            const supplierState = (inv.vendor?.address?.state || inv.vendor?.state || '').toLowerCase().trim();
            const isSameState = supplierState && companyState && (supplierState === companyState);

            let type = 'IGST';
            if (isSameState) {
                type = 'CGST/SGST';
                summary.inputGST.cgst += tax / 2;
                summary.inputGST.sgst += tax / 2;
            } else {
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
    } catch (error) {
        console.error('❌ Error in getTaxSummary:', error);
        res.status(500).json({ success: false, message: 'Tax summary calculation failed', error: error.message });
    }
};
