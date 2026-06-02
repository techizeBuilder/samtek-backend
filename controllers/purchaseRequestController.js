import PurchaseRequest from '../models/PurchaseRequest.js';
import Sale from '../models/Sale.js';
import Order from '../models/Order.js'; // Essential to register Order schema for population
import QCJob from '../models/QCJob.js';

// Generate a unique requestId safely (avoids E11000 duplicate key errors)
async function generateUniqueRequestId() {
  let attempts = 0;
  while (attempts < 20) {
    const count = await PurchaseRequest.countDocuments({});
    const candidate = `PR${String(count + 1 + attempts).padStart(3, '0')}`;
    const exists = await PurchaseRequest.findOne({ requestId: candidate }).lean();
    if (!exists) return candidate;
    attempts++;
  }
  // Fallback: timestamp-based ID
  return `PR-${Date.now().toString().slice(-6)}`;
}

// Get all purchase requests for a company
export const getPurchaseRequests = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'User company is not configured' });
    }

    // --- Auto-sync existing matching Sales to Purchase Requests ---
    try {
      const matchingSales = await Sale.find({
        companyId,
        isAvailableInInventory: 'Not Available',
        productType: 'Purchased (Trading Product)'
      }).populate('order');

      for (const sale of matchingSales) {
        const sourceRefId = sale.invoiceNumber || sale._id.toString();
        
        const existingReq = await PurchaseRequest.findOne({
          companyId,
          itemId: sourceRefId
        });

        if (!existingReq) {
          const firstItem = sale.items && sale.items.length > 0 ? sale.items[0].productName : 'Order Items';
          const productName = sale.items && sale.items.length > 1 ? `${firstItem} + ${sale.items.length - 1} more` : firstItem;
          
          const requestId = await generateUniqueRequestId();

          await PurchaseRequest.create({
            requestId,
            productName,
            quantity: sale.items?.reduce((acc, item) => acc + (item.quantity || 0), 0) || 1,
            requestFromDepartment: 'Store',
            priority: sale.order?.priority || 'Medium',
            companyId,
            storeOrderId: sale.order?._id || sale._id,
            itemId: sourceRefId
          });
          console.log(`Auto-synced existing sale to Purchase Request: ${requestId}`);
        }
      }
    } catch (syncError) {
      console.error('Error during auto-sync of Purchase Requests:', syncError);
    }
    // -------------------------------------------------------------

    const query = { companyId };
    if (req.user.role === 'Store Head' || req.user.role === 'Store Employee') {
      query.requestFromDepartment = 'Store';
    }

    const requests = await PurchaseRequest.find(query)
      .populate({
        path: 'purchaseOrder',
        populate: { path: 'supplier' }
      })
      .sort({ createdAt: -1 });

    // --- Self-healing sync: Auto-update status to Ordered if a PO is linked and status is Pending/Approved ---
    let updatedAny = false;
    for (const reqObj of requests) {
      if (reqObj.purchaseOrder && (reqObj.status === 'Pending' || reqObj.status === 'Approved')) {
        reqObj.status = 'Ordered';
        await reqObj.save();
        updatedAny = true;
        console.log(`[Self-healing] Auto-synced request status to Ordered for ${reqObj.requestId} because PO exists`);
      }
    }
    
    // Re-fetch if any requests were modified to have correct populated data and status in response
    let finalRequests = requests;
    if (updatedAny) {
      finalRequests = await PurchaseRequest.find(query)
        .populate({
          path: 'purchaseOrder',
          populate: { path: 'supplier' }
        })
        .sort({ createdAt: -1 });
    }

    res.status(200).json({ success: true, data: finalRequests });
  } catch (error) {
    console.error('Error fetching purchase requests:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Create a new purchase request
export const createPurchaseRequest = async (req, res) => {
  try {
    const { productName, quantity, requestFromDepartment, priority, storeOrderId, itemId } = req.body;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({ success: false, message: 'User company is not configured' });
    }

    // Generate Request ID globally to prevent unique index duplicates across companies
    const requestId = await generateUniqueRequestId();

    const newRequest = await PurchaseRequest.create({
      requestId,
      productName,
      quantity,
      requestFromDepartment: (req.user.role === 'Store Head' || req.user.role === 'Store Employee') ? 'Store' : (requestFromDepartment || 'Store'),
      priority,
      companyId,
      storeOrderId,
      itemId
    });

    res.status(201).json({ success: true, data: newRequest });
  } catch (error) {
    console.error('Error creating purchase request:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

const today = () => new Date().toISOString().split('T')[0];

async function generateQCJobId() {
  const year = new Date().getFullYear();
  const lastJob = await QCJob.findOne({ 
    qcJobId: new RegExp(`^QC-${year}-`) 
  }).sort({ qcJobId: -1 }).lean();

  let nextNumber = 1;
  if (lastJob && lastJob.qcJobId) {
    const parts = lastJob.qcJobId.split('-');
    if (parts.length === 3) {
      const lastNumber = parseInt(parts[2]);
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }
  }

  return `QC-${year}-${String(nextNumber).padStart(4, '0')}`;
}

// Update purchase request status
export const updatePurchaseRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Enforce that Store Head / Store Employee can only change status to "Received"
    if (req.user.role === 'Store Head' || req.user.role === 'Store Employee') {
      if (status !== 'Received') {
        return res.status(403).json({ success: false, message: 'Store users can only change status to Received' });
      }
    }

    const request = await PurchaseRequest.findById(id).populate('purchaseOrder');
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    const oldStatus = request.status;
    request.status = status;
    await request.save();

    // Trigger QC Job & Purchase Invoice creation on 'Received' status transition
    if (status === 'Received' && oldStatus !== 'Received') {
      // 1. Generate QC Job
      try {
        const sourceRefId = request.purchaseOrder?.purchaseOrderNumber || request.requestId;
        
        // Check if a QC job for this sourceRefId already exists
        const existingQC = await QCJob.findOne({
          source: 'Purchase',
          sourceRefId: sourceRefId,
          company: request.companyId
        });

        if (!existingQC) {
          const qcJobId = await generateQCJobId();
          
          await QCJob.create({
            qcJobId,
            source: 'Purchase',
            sourceRefId: sourceRefId,
            sourceDepartment: 'Store',
            sentBy: req.user.fullName || req.user.username || 'Store Dept',
            itemName: request.productName,
            itemCode: request.itemId || request.requestId,
            category: 'Raw Material', // purchase items are typically raw materials/trading goods
            quantity: request.quantity || 1,
            unit: 'pcs',
            receivedDate: today(),
            status: 'Pending',
            company: request.companyId,
            createdBy: req.user._id,
            notes: `Automatically created from Store Purchase Requisition: ${request.requestId}`
          });
          console.log(`✅ QC Job ${qcJobId} automatically created for Purchase Request ${request.requestId}`);
        }
      } catch (qcError) {
        console.error('❌ Error creating QC job from Purchase Request:', qcError);
      }

      // 2. Generate Purchase Invoice
      try {
        const { createAutoPurchaseInvoice } = await import('./purchaseInvoiceController.js');
        await createAutoPurchaseInvoice(request, req.user);
        console.log(`✅ [Purchase Receipt] Created purchase invoice for request: ${request.requestId}`);
      } catch (invoiceError) {
        console.error('❌ Error creating purchase invoice on request receipt:', invoiceError);
      }
    }

    res.status(200).json({ success: true, data: request });
  } catch (error) {
    console.error('Error updating purchase request:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
