import ProductionOrder from '../models/ProductionOrder.js';
import Order from '../models/Order.js';
import Sale from '../models/Sale.js';
import PurchaseRequest from '../models/PurchaseRequest.js';

// Resolves the customer-facing Order.orderCode (e.g. "ORD-0043") that a QC
// job traces back to. QCJob.sourceRefId only holds a department-local
// reference (e.g. a ProductionOrder's own code like "PROD-2026-597528"), not
// the sales Order ID, so several fallback strategies are needed depending on
// how the job entered QC (direct Sale link, Production, or Purchase).
export async function resolveSalesOrderCodeForQCJob(job, companyId) {
  let salesOrderCode = null;

  if (job.saleId) {
    try {
      const sale = await Sale.findById(job.saleId).select('order').lean();
      if (sale?.order) {
        const salesOrder = await Order.findById(sale.order).select('orderCode').lean();
        salesOrderCode = salesOrder?.orderCode || null;
      }
    } catch (e) { console.error('Error resolving saleId for QC job sales code:', e); }
  } else if (job.source === 'Production' || job.source === 'QC_Rejected') {
    try {
      const prodOrder = await ProductionOrder.findOne({
        orderId: job.sourceRefId,
        company: companyId,
      }).lean();

      if (prodOrder) {
        // STRATEGY A: machineCode IS the orderCode (when auto-created from Store)
        if (prodOrder.machineCode) {
          const orderByCode = await Order.findOne({
            orderCode: prodOrder.machineCode,
            companyId,
          }).select('orderCode').lean();
          if (orderByCode?.orderCode) salesOrderCode = orderByCode.orderCode;
        }

        // STRATEGY B: Sale referenced from notes "Ref: <saleId or invoiceNumber>"
        if (!salesOrderCode && prodOrder.notes) {
          const notesRefMatch = prodOrder.notes.match(/Ref:\s*(\S+)/);
          const refId = notesRefMatch ? notesRefMatch[1] : null;
          if (refId) {
            const saleByRef = await Sale.findOne({
              $or: [
                { _id: /^[0-9a-fA-F]{24}$/.test(refId) ? refId : null },
                { invoiceNumber: refId },
              ]
            }).select('order').lean();
            if (saleByRef?.order) {
              const orderByRef = await Order.findById(saleByRef.order).select('orderCode').lean();
              if (orderByRef?.orderCode) salesOrderCode = orderByRef.orderCode;
            }
          }
        }

        // STRATEGY C: closest-in-time Sale with a matching item name
        if (!salesOrderCode && prodOrder.machineName) {
          const sales = await Sale.find({
            companyId,
            storeQCStatus: { $in: ['Goes to Production', 'Production Completed'] },
            'items.productName': prodOrder.machineName,
          }).select('order createdAt').lean();

          if (sales.length > 0) {
            let closestSale = null;
            let minDiff = Infinity;
            const prodTime = new Date(prodOrder.createdAt).getTime();
            for (const s of sales) {
              const diff = Math.abs(prodTime - new Date(s.createdAt).getTime());
              if (diff < minDiff) { minDiff = diff; closestSale = s; }
            }
            if (closestSale?.order) {
              const orderByItem = await Order.findById(closestSale.order).select('orderCode').lean();
              if (orderByItem?.orderCode) salesOrderCode = orderByItem.orderCode;
            }
          }
        }
      }
    } catch (e) { console.error('Error resolving Production sourceRefId for QC job sales code:', e); }
  } else if (job.purchaseRequestId) {
    try {
      const pr = await PurchaseRequest.findById(job.purchaseRequestId).lean();
      if (pr && pr.storeOrderId) {
        const salesOrder = await Order.findById(pr.storeOrderId).select('orderCode').lean();
        salesOrderCode = salesOrder?.orderCode || null;
        if (!salesOrderCode) {
          const sale = await Sale.findById(pr.storeOrderId).select('order').lean();
          if (sale?.order) {
            const salesOrder2 = await Order.findById(sale.order).select('orderCode').lean();
            salesOrderCode = salesOrder2?.orderCode || null;
          }
        }
      }
    } catch (e) { console.error('Error resolving purchaseRequestId for QC job sales code:', e); }
  }

  return salesOrderCode;
}
