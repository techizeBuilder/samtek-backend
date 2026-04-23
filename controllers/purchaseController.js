import Purchase from '../models/Purchase.js';
import Supplier from '../models/Supplier.js';
import { Item } from '../models/Inventory.js';
import { USER_ROLES } from '../../shared/schema.js';

export const getPurchases = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, paymentStatus, unit, search } = req.query;
    const skip = (page - 1) * limit;

    let query = {};

    if (req.user.role !== USER_ROLES.SUPER_USER) {
      query.unit = req.user.unit;
    } else if (unit) {
      query.unit = unit;
    }

    if (status) {
      query.status = status;
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    if (search) {
      query.$or = [
        { purchaseOrderNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const purchases = await Purchase.find(query)
      .populate('supplier', 'supplierName contactPerson email phone')
      .populate('createdBy', 'fullName')
      .populate('approvedBy', 'fullName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Purchase.countDocuments(query);

    res.json({
      purchases,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get purchases error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getPurchaseById = async (req, res) => {
  try {
    const { id } = req.params;
    const purchase = await Purchase.findById(id)
      .populate('supplier')
      .populate('items.item', 'itemName itemCode')
      .populate('createdBy', 'fullName')
      .populate('approvedBy', 'fullName');

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && purchase.unit !== req.user.unit) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ purchase });
  } catch (error) {
    console.error('Get purchase by ID error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const createPurchase = async (req, res) => {
  try {
    const {
      supplier,
      items,
      expectedDeliveryDate,
      taxAmount,
      deliveryAddress,
      terms,
      notes
    } = req.body;

    if (!supplier || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Supplier and items are required' });
    }

    // Validate supplier exists
    const supplierDoc = await Supplier.findById(supplier);
    if (!supplierDoc) {
      return res.status(400).json({ message: 'Supplier not found' });
    }

    // Validate items and calculate totals
    let totalAmount = 0;
    const purchaseItems = [];

    for (const item of items) {
      const inventoryItem = await Inventory.findById(item.item);
      if (!inventoryItem) {
        return res.status(400).json({ message: `Inventory item ${item.item} not found` });
      }

      const itemTotal = item.quantity * item.unitPrice;
      totalAmount += itemTotal;

      purchaseItems.push({
        item: item.item,
        itemName: inventoryItem.itemName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: itemTotal,
        receivedQuantity: 0,
        pendingQuantity: item.quantity
      });
    }

    const taxAmt = taxAmount || 0;
    const grandTotal = totalAmount + taxAmt;

    const purchaseData = {
      supplier,
      items: purchaseItems,
      totalAmount,
      taxAmount: taxAmt,
      grandTotal,
      expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      unit: req.user.role === USER_ROLES.SUPER_USER ? req.body.unit : req.user.unit,
      createdBy: req.user._id,
      deliveryAddress,
      terms,
      notes
    };

    const purchase = await Purchase.create(purchaseData);
    await purchase.populate([
      { path: 'supplier', select: 'supplierName contactPerson email phone' },
      { path: 'createdBy', select: 'fullName' }
    ]);

    res.status(201).json({
      message: 'Purchase order created successfully',
      purchase
    });
  } catch (error) {
    console.error('Create purchase error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updatePurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      paymentStatus,
      expectedDeliveryDate,
      actualDeliveryDate,
      deliveryAddress,
      terms,
      notes,
      approvedBy
    } = req.body;

    const purchase = await Purchase.findById(id);

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && purchase.unit !== req.user.unit) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updateData = {};

    if (status) {
      updateData.status = status;
      if (status === 'Received') {
        updateData.actualDeliveryDate = actualDeliveryDate ? new Date(actualDeliveryDate) : new Date();
      }
    }

    if (paymentStatus) updateData.paymentStatus = paymentStatus;
    if (expectedDeliveryDate) updateData.expectedDeliveryDate = new Date(expectedDeliveryDate);
    if (deliveryAddress) updateData.deliveryAddress = deliveryAddress;
    if (terms) updateData.terms = terms;
    if (notes) updateData.notes = notes;

    // Handle approval
    if (approvedBy && !purchase.isApproved) {
      updateData.isApproved = true;
      updateData.approvedBy = req.user._id;
      updateData.status = 'Sent';
    }

    const updatedPurchase = await Purchase.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate([
      { path: 'supplier', select: 'supplierName contactPerson email phone' },
      { path: 'createdBy', select: 'fullName' },
      { path: 'approvedBy', select: 'fullName' }
    ]);

    res.json({
      message: 'Purchase order updated successfully',
      purchase: updatedPurchase
    });
  } catch (error) {
    console.error('Update purchase error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const deletePurchase = async (req, res) => {
  try {
    const { id } = req.params;

    const purchase = await Purchase.findById(id);

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && purchase.unit !== req.user.unit) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (['Sent', 'Acknowledged', 'Partially Received', 'Received'].includes(purchase.status)) {
      return res.status(400).json({ message: 'Cannot delete purchase order that has been sent or received' });
    }

    await Purchase.findByIdAndDelete(id);

    res.json({ message: 'Purchase order deleted successfully' });
  } catch (error) {
    console.error('Delete purchase error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const receivePurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const { receivedItems } = req.body;

    if (!receivedItems || !Array.isArray(receivedItems)) {
      return res.status(400).json({ message: 'Received items data is required' });
    }

    const purchase = await Purchase.findById(id).populate('items.item');

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && purchase.unit !== req.user.unit) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Update received quantities and inventory
    for (const receivedItem of receivedItems) {
      const purchaseItem = purchase.items.find(item =>
        item.item._id.toString() === receivedItem.itemId
      );

      if (purchaseItem && receivedItem.receivedQuantity > 0) {
        purchaseItem.receivedQuantity += receivedItem.receivedQuantity;
        purchaseItem.pendingQuantity = purchaseItem.quantity - purchaseItem.receivedQuantity;

        // Update inventory stock
        const inventoryItem = await Inventory.findById(purchaseItem.item._id);
        if (inventoryItem) {
          const previousStock = inventoryItem.currentStock;
          inventoryItem.currentStock += receivedItem.receivedQuantity;
          await inventoryItem.save();

          // Create stock movement record
          const { StockMovement } = await import('../models/Inventory.js');
          await StockMovement.create({
            item: inventoryItem._id,
            movementType: 'IN',
            quantity: receivedItem.receivedQuantity,
            previousStock,
            newStock: inventoryItem.currentStock,
            reference: `Purchase Order: ${purchase.purchaseOrderNumber}`,
            referenceId: purchase._id,
            unit: purchase.unit,
            createdBy: req.user._id,
            notes: `Received from ${purchase.supplier.supplierName}`
          });
        }
      }
    }

    // Update purchase status
    const allReceived = purchase.items.every(item => item.pendingQuantity === 0);
    const partiallyReceived = purchase.items.some(item => item.receivedQuantity > 0);

    if (allReceived) {
      purchase.status = 'Received';
      purchase.actualDeliveryDate = new Date();
    } else if (partiallyReceived) {
      purchase.status = 'Partially Received';
    }

    await purchase.save();

    await purchase.populate([
      { path: 'supplier', select: 'supplierName contactPerson' },
      { path: 'items.item', select: 'itemName itemCode' }
    ]);

    res.json({
      message: 'Purchase received successfully',
      purchase
    });
  } catch (error) {
    console.error('Receive purchase error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getPurchaseStats = async (req, res) => {
  try {
    const { unit, period = 'month' } = req.query;
    let query = {};

    if (req.user.role !== USER_ROLES.SUPER_USER) {
      query.unit = req.user.unit;
    } else if (unit) {
      query.unit = unit;
    }

    const now = new Date();
    let startDate;

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'quarter':
        const quarterStart = Math.floor(now.getMonth() / 3) * 3;
        startDate = new Date(now.getFullYear(), quarterStart, 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const periodQuery = { ...query, createdAt: { $gte: startDate } };

    const [statusStats, totalAmount, pendingAmount] = await Promise.all([
      Purchase.aggregate([
        { $match: periodQuery },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$grandTotal' }
          }
        }
      ]),
      Purchase.aggregate([
        { $match: periodQuery },
        { $group: { _id: null, total: { $sum: '$grandTotal' } } }
      ]),
      Purchase.aggregate([
        { $match: { ...periodQuery, paymentStatus: 'Pending' } },
        { $group: { _id: null, total: { $sum: '$grandTotal' } } }
      ])
    ]);

    res.json({
      period,
      statusStats,
      totalAmount: totalAmount.length > 0 ? totalAmount[0].total : 0,
      pendingAmount: pendingAmount.length > 0 ? pendingAmount[0].total : 0
    });
  } catch (error) {
    console.error('Get purchase stats error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Get inventory items for purchase (excluding Product type, only Material, Spares, Assemblies)
export const getPurchaseItems = async (req, res) => {
  try {
    const { search = '', type = '', skip = 0, limit = 20 } = req.query;

    // Get user's company ID from request - it's the company/store filter
    const userCompanyId = req.user.companyId;
    const userCompanyIdString = userCompanyId ? userCompanyId.toString() : null;

    console.log('🔍 User company ID:', userCompanyId);
    console.log('🔍 User company ID (string):', userCompanyIdString);
    console.log('📊 Search:', search, 'Type:', type);

    // Build filter query:
    // 1. Company filter (store matches user's companyId)
    // 2. Type filter (Material, Spares, Assemblies) OR purchase: true (Trading Goods)
    let filter = {
      store: userCompanyIdString,
      $or: [
        { type: { $in: ['Material', 'Spares', 'Assemblies'] } },
        { purchase: true }
      ]
    };

    // Add search filter if provided
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

    // Debug: count before and after filters - get breakdown by type
    const typeBreakdown = await Item.aggregate([
      {
        $match: {
          $or: [
            { store: userCompanyIdString },
            { store: userCompanyId }
          ]
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      }
    ]);

    console.log(`📊 Items breakdown by type:`, typeBreakdown);

    const allCompanyItems = await Item.countDocuments({
      $or: [
        { store: userCompanyIdString },
        { store: userCompanyId }
      ]
    });

    console.log(`📈 Total items in company: ${allCompanyItems}`);

    // Get items with pagination
    const [items, total] = await Promise.all([
      Item.find(filter)
        .select('_id name code category type qty unit purchaseCost stdCost gst minStock store')
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .sort({ name: 1 })
        .lean(),
      Item.countDocuments(filter)
    ]);

    console.log(`✅ Returning ${items.length} items (Total matching: ${total})`);

    res.json({
      success: true,
      data: {
        items: items.map(item => ({
          _id: item._id,
          name: item.name,
          code: item.code,
          category: item.category,
          type: item.type,
          currentQty: item.qty,
          unit: item.unit,
          purchaseCost: item.purchaseCost,
          stdCost: item.stdCost,
          gst: item.gst,
          minStock: item.minStock,
          store: item.store
        })),
        pagination: {
          skip: parseInt(skip),
          limit: parseInt(limit),
          total,
          hasMore: parseInt(skip) + parseInt(limit) < total
        }
      }
    });
  } catch (error) {
    console.error('❌ Get purchase items error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch purchase items',
      error: error.message
    });
  }
};
