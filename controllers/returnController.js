import Return from '../models/Return.js';
import Customer from '../models/Customer.js';
import Product from '../models/Product.js';
import Brand from '../models/Brand.js';
import { Item } from '../models/Inventory.js';
import { validationResult } from 'express-validator';

// Get all returns with filtering and pagination
export const getAllReturns = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = {};

    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.type) {
      filter.type = req.query.type;
    }

    if (req.query.customerId) {
      filter.customerId = req.query.customerId;
    }

    if (req.query.search) {
      filter.$or = [
        { customerName: { $regex: req.query.search, $options: 'i' } },
        { reason: { $regex: req.query.search, $options: 'i' } },
        { 'items.productName': { $regex: req.query.search, $options: 'i' } }
      ];
    }

    if (req.query.startDate || req.query.endDate) {
      filter.returnDate = {};
      if (req.query.startDate) {
        filter.returnDate.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filter.returnDate.$lte = new Date(req.query.endDate);
      }
    }

    // Get total count for pagination
    const total = await Return.countDocuments(filter);

    // Get returns with population (use Item model for productId)
    const returns = await Return.find(filter)
      .populate('customerId', 'name email mobile')
      .populate('items.productId', 'name salePrice stdCost image category', 'Item')
      .populate('items.brandId', 'name')
      .populate('createdBy', 'username fullName')
      .populate('updatedBy', 'username fullName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      returns,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit
      }
    });

  } catch (error) {
    console.error('Error fetching returns:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching returns',
      error: error.message
    });
  }
};

// Get single return by ID
export const getReturnById = async (req, res) => {
  try {
    const returnDoc = await Return.findById(req.params.id)
      .populate('customerId', 'name email mobile address')
      .populate('items.productId', 'name salePrice stdCost image description category', 'Item')
      .populate('items.brandId', 'name description')
      .populate('createdBy', 'username fullName')
      .populate('updatedBy', 'username fullName');

    if (!returnDoc) {
      return res.status(404).json({
        success: false,
        message: 'Return entry not found'
      });
    }

    res.json({
      success: true,
      return: returnDoc
    });

  } catch (error) {
    console.error('Error fetching return:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching return',
      error: error.message
    });
  }
};

// Create new return
export const createReturn = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.mapped()
      });
    }

    const { customerId, returnDate, reason, items, type, notes } = req.body;

    // Verify customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Verify all inventory items exist
    for (const item of items) {
      const inventoryItem = await Item.findById(item.productId);
      if (!inventoryItem) {
        return res.status(404).json({
          success: false,
          message: `Inventory item not found: ${item.productName}`
        });
      }

      // Optional: Check if brandId is provided and validate it
      if (item.brandId) {
        const brand = await Brand.findById(item.brandId);
        if (!brand) {
          return res.status(404).json({
            success: false,
            message: `Brand not found for item: ${item.productName}`
          });
        }
      }
    }

    // Create return entry data
    const returnData = {
      customerId,
      customerName: customer.name,
      returnDate: returnDate || new Date(),
      reason,
      items,
      type: type || 'refund',
      notes: notes || '',
      createdBy: req.user?.id
    };

    // If order ID is provided in body, fetch order to get orderDate
    if (req.body.order) {
      try {
        const orderDoc = await (await import('../models/Order.js')).default.findById(req.body.order);
        if (orderDoc) {
          returnData.orderDate = orderDoc.orderDate || orderDoc.createdAt;
          returnData.order = req.body.order;
        }
      } catch (err) {
        console.error('Error fetching order for return date (creation):', err);
      }
    } else if (req.body.orderId) { // some APIs use orderId
      try {
        const orderDoc = await (await import('../models/Order.js')).default.findById(req.body.orderId);
        if (orderDoc) {
          returnData.orderDate = orderDoc.orderDate || orderDoc.createdAt;
          returnData.order = req.body.orderId;
        }
      } catch (err) {
        console.error('Error fetching order for return date (creation via orderId):', err);
      }
    }

    const returnDoc = new Return(returnData);

    await returnDoc.save();

    // Populate the created return (use Item model for productId)
    await returnDoc.populate([
      { path: 'customerId', select: 'name email mobile' },
      { path: 'items.productId', select: 'name salePrice stdCost image category', model: 'Item' },
      { path: 'items.brandId', select: 'name' },
      { path: 'createdBy', select: 'username fullName' }
    ]);

    res.status(201).json({
      success: true,
      message: 'Return entry created successfully',
      returnId: returnDoc._id,
      return: returnDoc
    });

  } catch (error) {
    console.error('Error creating return:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating return entry',
      error: error.message
    });
  }
};

// Update return
export const updateReturn = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.mapped()
      });
    }

    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) {
      return res.status(404).json({
        success: false,
        message: 'Return entry not found'
      });
    }

    const { customerId, returnDate, reason, items, type, notes, status } = req.body;

    // If customer is being changed, verify it exists
    if (customerId && customerId !== returnDoc.customerId.toString()) {
      const customer = await Customer.findById(customerId);
      if (!customer) {
        return res.status(404).json({
          success: false,
          message: 'Customer not found'
        });
      }
      returnDoc.customerId = customerId;
      returnDoc.customerName = customer.name;
    }

    // Update fields
    if (returnDate) returnDoc.returnDate = returnDate;
    if (reason) returnDoc.reason = reason;
    if (items) returnDoc.items = items;
    if (type) returnDoc.type = type;
    if (notes !== undefined) returnDoc.notes = notes;
    if (status) returnDoc.status = status;

    returnDoc.updatedBy = req.user?.id;

    await returnDoc.save();

    // Populate the updated return (use Item model for productId)
    await returnDoc.populate([
      { path: 'customerId', select: 'name email mobile' },
      { path: 'items.productId', select: 'name salePrice stdCost image category', model: 'Item' },
      { path: 'items.brandId', select: 'name' },
      { path: 'updatedBy', select: 'username fullName' }
    ]);

    res.json({
      success: true,
      message: 'Return entry updated successfully',
      return: returnDoc
    });

  } catch (error) {
    console.error('Error updating return:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating return entry',
      error: error.message
    });
  }
};

// Update return status
export const updateReturnStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!status || !['pending', 'approved', 'completed', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required (pending, approved, completed, rejected)'
      });
    }

    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) {
      return res.status(404).json({
        success: false,
        message: 'Return entry not found'
      });
    }

    // If status is being updated to 'approved', deduct amount from customer outstanding and sync with Invoices
    if (status === 'approved' && returnDoc.status !== 'approved') {
      try {
        const customer = await Customer.findById(returnDoc.customerId);
        if (customer) {
          const oldBalance = customer.outstandingAmount || 0;
          customer.outstandingAmount = oldBalance - (returnDoc.totalAmount || 0);
          await customer.save();
          console.log(`💰 Updated Customer ${customer.name} balance via general update: ${oldBalance} -> ${customer.outstandingAmount}`);

          // SYNC INVOICE BALANCES FOR AGEING REPORT
          let remainingReturnAmount = returnDoc.totalAmount || 0;

          // 1. Try targeted invoice if order is linked
          if (returnDoc.order) {
            const Sale = (await import('../models/Sale.js')).default;
            const targetInvoice = await Sale.findOne({ order: returnDoc.order });
            if (targetInvoice && targetInvoice.balanceAmount > 0) {
              const reduction = Math.min(targetInvoice.balanceAmount, remainingReturnAmount);
              targetInvoice.balanceAmount -= reduction;
              remainingReturnAmount -= reduction;
              await targetInvoice.save();
              console.log(`📑 Reduced targeted invoice ${targetInvoice.invoiceNumber} balance by ${reduction}`);
            }
          }

          // 2. FIFO reduction for remaining amount
          if (remainingReturnAmount > 0) {
            const Sale = (await import('../models/Sale.js')).default;
            const unpaidInvoices = await Sale.find({
              customer: returnDoc.customerId,
              balanceAmount: { $gt: 0 }
            }).sort({ saleDate: 1 });

            for (const inv of unpaidInvoices) {
              if (remainingReturnAmount <= 0) break;
              const reduction = Math.min(inv.balanceAmount, remainingReturnAmount);
              inv.balanceAmount -= reduction;
              remainingReturnAmount -= reduction;
              await inv.save();
              console.log(`📑 Reduced invoice ${inv.invoiceNumber} balance by ${reduction} (FIFO)`);
            }
          }
        }
      } catch (err) {
        console.error('❌ Error updating customer balance in return status update:', err);
      }
    }

    returnDoc.status = status;
    returnDoc.updatedBy = req.user?.id;

    await returnDoc.save();

    res.json({
      success: true,
      message: 'Return status updated successfully',
      return: returnDoc
    });

  } catch (error) {
    console.error('Error updating return status:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating return status',
      error: error.message
    });
  }
};

// Delete return
export const deleteReturn = async (req, res) => {
  try {
    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) {
      return res.status(404).json({
        success: false,
        message: 'Return entry not found'
      });
    }

    await Return.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Return entry deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting return:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting return entry',
      error: error.message
    });
  }
};

// Get return statistics
export const getReturnStats = async (req, res) => {
  try {
    const total = await Return.countDocuments();
    const pending = await Return.countDocuments({ status: 'pending' });
    const approved = await Return.countDocuments({ status: 'approved' });
    const completed = await Return.countDocuments({ status: 'completed' });
    const rejected = await Return.countDocuments({ status: 'rejected' });

    const refunds = await Return.countDocuments({ type: 'refund' });
    const damages = await Return.countDocuments({ type: 'damage' });

    // Calculate total amount
    const totalAmountResult = await Return.aggregate([
      { $group: { _id: null, totalAmount: { $sum: '$totalAmount' } } }
    ]);
    const totalAmount = totalAmountResult[0]?.totalAmount || 0;

    res.json({
      success: true,
      stats: {
        total,
        pending,
        approved,
        completed,
        rejected,
        refunds,
        damages,
        totalAmount
      }
    });

  } catch (error) {
    console.error('Error fetching return stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching return statistics',
      error: error.message
    });
  }
};