import User from '../models/User.js';
import Customer from '../models/Customer.js';
import Order from '../models/Order.js';
import Dispatch from '../models/Dispatch.js';
import DispatchOrder from '../models/DispatchOrder.js';
import Sale from '../models/Sale.js';
import Return from '../models/Return.js';
import { Item } from '../models/Inventory.js';
import { Company } from '../models/Company.js';
import { USER_ROLES } from '../shared/schema.js';
import PriorityProduct from '../models/PriorityProduct.js';
import CutoffTime from '../models/CutoffTime.js';
import { sendPaymentReminderEmail, sendQuotationEmail } from '../services/emailService.js';

export const getSales = async (req, res) => {
  try {
    const { page = 1, limit = 10, paymentStatus, unit, search } = req.query;
    const skip = (page - 1) * limit;

    let query = {};

    if (req.user.role !== USER_ROLES.SUPER_USER) {
      query.unit = req.user.unit;
    } else if (unit) {
      query.unit = unit;
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    if (search) {
      query.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const sales = await Sale.find(query)
      .populate('order', 'orderNumber')
      .populate('customer', 'customerName contactPerson email phone')
      .populate('dispatch', 'dispatchNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Sale.countDocuments(query);

    res.json({
      sales,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get sales error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getSaleById = async (req, res) => {
  try {
    const { id } = req.params;
    const sale = await Sale.findById(id)
      .populate('order')
      .populate('customer')
      .populate('dispatch');

    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && sale.unit !== req.user.unit) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ sale });
  } catch (error) {
    console.error('Get sale by ID error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const createSale = async (req, res) => {
  try {
    const {
      order,
      customer,
      items,
      taxAmount,
      paymentMethod,
      dueDate,
      dispatch,
      notes
    } = req.body;

    if (!order || !customer || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Order, customer, and items are required' });
    }

    // Validate order and customer exist
    const [orderDoc, customerDoc] = await Promise.all([
      Order.findById(order),
      Customer.findById(customer)
    ]);

    if (!orderDoc) {
      return res.status(400).json({ message: 'Order not found' });
    }

    if (!customerDoc) {
      return res.status(400).json({ message: 'Customer not found' });
    }

    // Calculate totals
    let subtotal = 0;
    const saleItems = items.map(item => {
      const itemTotal = item.quantity * item.unitPrice;
      subtotal += itemTotal;
      return {
        ...item,
        totalPrice: itemTotal
      };
    });

    const taxAmt = taxAmount || 0;
    const totalAmount = subtotal + taxAmt;

    const saleData = {
      order,
      customer,
      items: saleItems,
      subtotal,
      taxAmount: taxAmt,
      totalAmount,
      paymentMethod,
      dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      unit: req.user.role === USER_ROLES.SUPER_USER ? req.body.unit : req.user.unit,
      companyId: req.user.companyId,
      dispatch,
      notes
    };

    const sale = await Sale.create(saleData);
    await sale.populate([
      { path: 'order', select: 'orderNumber' },
      { path: 'customer', select: 'customerName contactPerson email phone' }
    ]);

    // Update customer outstanding balance
    await Customer.findByIdAndUpdate(customer, {
      $inc: { outstandingAmount: totalAmount }
    });

    res.status(201).json({
      message: 'Sale created successfully',
      sale
    });
  } catch (error) {
    console.error('Create sale error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateSale = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      paymentStatus,
      paymentMethod,
      paidAmount,
      paidDate,
      dueDate,
      notes
    } = req.body;

    const sale = await Sale.findById(id);

    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && sale.unit !== req.user.unit) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updateData = {};

    if (paymentStatus) {
      updateData.paymentStatus = paymentStatus;
      if (paymentStatus === 'Paid') {
        updateData.paidDate = paidDate ? new Date(paidDate) : new Date();
        updateData.paidAmount = paidAmount || sale.totalAmount;
      }
    }

    if (paymentMethod) updateData.paymentMethod = paymentMethod;
    if (paidAmount !== undefined) updateData.paidAmount = paidAmount;
    if (dueDate) updateData.dueDate = new Date(dueDate);
    if (notes) updateData.notes = notes;

    const updatedSale = await Sale.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate([
      { path: 'order', select: 'orderNumber' },
      { path: 'customer', select: 'customerName contactPerson email phone' },
      { path: 'dispatch', select: 'dispatchNumber' }
    ]);

    // Verify change in total amount to update outstanding balance
    const amountDifference = updatedSale.totalAmount - sale.totalAmount;
    if (Math.abs(amountDifference) > 0.01) {
      await Customer.findByIdAndUpdate(sale.customer, {
        $inc: { outstandingAmount: amountDifference }
      });
    }

    res.json({
      message: 'Sale updated successfully',
      sale: updatedSale
    });
  } catch (error) {
    console.error('Update sale error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const deleteSale = async (req, res) => {
  try {
    const { id } = req.params;

    const sale = await Sale.findById(id);

    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && sale.unit !== req.user.unit) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (sale.paymentStatus === 'Paid') {
      return res.status(400).json({ message: 'Cannot delete paid sale' });
    }

    await Sale.findByIdAndDelete(id);

    await Sale.findByIdAndDelete(id);

    // Reduce customer outstanding by the deleted sale amount
    // If it was partially paid, the payment remains valid as credit/advance, 
    // so we reduce the full sale liability.
    await Customer.findByIdAndUpdate(sale.customer, {
      $inc: { outstandingAmount: -sale.totalAmount }
    });

    res.json({ message: 'Sale deleted successfully' });
  } catch (error) {
    console.error('Delete sale error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getSalesStats = async (req, res) => {
  try {
    const { unit, period = 'month' } = req.query;
    let query = {};

    if (req.user.role !== USER_ROLES.SUPER_USER) {
      query.unit = req.user.unit;
    } else if (unit) {
      query.unit = unit;
    }

    // Date range based on period
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

    const [totalSales, paidSales, pendingSales, overdueSales] = await Promise.all([
      Sale.aggregate([
        { $match: periodQuery },
        { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
      ]),
      Sale.aggregate([
        { $match: { ...periodQuery, paymentStatus: 'Paid' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
      ]),
      Sale.aggregate([
        { $match: { ...periodQuery, paymentStatus: 'Pending' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
      ]),
      Sale.aggregate([
        { $match: { ...periodQuery, paymentStatus: 'Overdue' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
      ])
    ]);

    res.json({
      period,
      totalSales: totalSales[0] || { total: 0, count: 0 },
      paidSales: paidSales[0] || { total: 0, count: 0 },
      pendingSales: pendingSales[0] || { total: 0, count: 0 },
      overdueSales: overdueSales[0] || { total: 0, count: 0 }
    });

  } catch (error) {
    console.error('Get sales stats error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Salesperson-specific controller functions
export const getSalespersonCustomers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      category = '',
      status = '',
      customerType = '',
      name = '',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    const salespersonId = req.user._id || req.user.id;
    const salespersonUsername = req.user.username;
    const userRole = req.user.role;
    const userCompanyId = req.user.companyId;

    // Handle search (name parameter or search parameter) - declare early
    const searchTerm = search || name;

    console.log('🔍 getSalespersonCustomers called:', {
      username: salespersonUsername,
      role: userRole,
      companyId: userCompanyId,
      queryParams: req.query,
      filters: {
        status,
        customerType,
        category,
        search: search,
        searchTerm: searchTerm
      }
    });

    // Build filter query based on user role with company isolation
    let query = {};

    // Always filter by company for data isolation
    if (userCompanyId) {
      query.companyId = userCompanyId;
    }

    // If user is Sales or Sales Employee role, only show customers assigned to them
    if (userRole === 'Sales' || userRole === 'Sales Employee') {
      query.$and = [
        { companyId: userCompanyId }, // Company isolation
        { salesContact: salespersonId } // Assigned customers only
      ];
    }
    // Unit Manager and Super Admin can see all customers from their company
    else if (userRole !== 'Superadmin') {
      // For non-Super Admin roles, ensure company filtering
      query.companyId = userCompanyId;
    }

    // Handle search with already declared searchTerm
    if (searchTerm) {
      const searchQuery = {
        $or: [
          { name: { $regex: searchTerm, $options: 'i' } },
          { contactPerson: { $regex: searchTerm, $options: 'i' } },
          { email: { $regex: searchTerm, $options: 'i' } },
          { mobile: { $regex: searchTerm, $options: 'i' } }
        ]
      };

      if (query.$and) {
        query.$and.push(searchQuery);
      } else {
        query.$and = [query, searchQuery];
      }
    }

    // Handle status filter (active field)
    if (status && status !== 'All') {
      query.active = status; // 'Yes' or 'No'
    }

    // Handle category filter (support both 'category' and 'customerType' parameters)
    const categoryFilter = category || customerType;
    if (categoryFilter && categoryFilter !== 'All') {
      query.category = categoryFilter;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Handle sorting
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    console.log('🔍 Final query details:', {
      query: JSON.stringify(query),
      sortOptions,
      skip,
      limit: parseInt(limit),
      filters: {
        status,
        customerType,
        category,
        categoryFilterUsed: category || customerType
      }
    });

    const customers = await Customer.find(query)
      .populate('salesContact', 'username email')
      .populate('companyId', 'name')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Customer.countDocuments(query);

    console.log('🔍 Query executed:', {
      query: JSON.stringify(query),
      total,
      returned: customers.length
    });

    res.json({
      success: true,
      customers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get salesperson customers error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getSalespersonDeliveries = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', status = '' } = req.query;
    const salespersonId = req.user._id || req.user.id;
    const userCompanyId = req.user.companyId;
    const userRole = req.user.role;

    console.log('🚚 getSalespersonDeliveries (Unified: Dispatch & DispatchOrder) called:', {
      userId: salespersonId,
      role: userRole,
      companyId: userCompanyId,
      status,
      search
    });

    // 1. QUERY BULK DISPATCHES
    const matchQuery = {
      company: userCompanyId
    };

    // Role-based filtering for bulk dispatches
    if (userRole === 'Sales' || userRole === 'Sales Employee' || (userRole !== 'Superadmin' && userRole !== 'Unit Manager' && userRole !== 'Unit Head' && userRole !== 'Sales Head')) {
      matchQuery.salesPerson = salespersonId;
    }

    matchQuery.status = { $in: ['verified', 'dispatched', 'completed', 'approved'] };

    if (status && status !== 'all') {
      matchQuery.status = status;
    }

    if (search) {
      matchQuery.$or = [
        { dcno: { $regex: search, $options: 'i' } },
        { productName: { $regex: search, $options: 'i' } },
        { vehicleNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const aggregationStages = [
      { $match: matchQuery },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$dcno',
          dcno: { $first: '$dcno' },
          date: { $first: '$date' },
          customer: { $first: '$customer' },
          vehicleNumber: { $first: '$vehicleNumber' },
          transporterName: { $first: '$transporterName' },
          status: { $first: '$status' },
          notes: { $first: '$notes' },
          items: {
            $push: {
              productName: '$productName',
              quantity: '$dispatchedQuantitySentToday',
              indentQty: '$indentQty',
              productId: '$productId'
            }
          },
          totalItems: { $sum: 1 },
          createdAt: { $first: '$createdAt' }
        }
      },
      { $sort: { createdAt: -1 } }
    ];

    const bulkDeliveries = await Dispatch.aggregate(aggregationStages);

    // Populate customer info for bulk deliveries
    const populatedBulkDeliveries = await Promise.all(bulkDeliveries.map(async (delivery) => {
      if (delivery.customer) {
        delivery.customer = await Customer.findById(delivery.customer).select('name email mobile city area address category').lean();
      }
      return delivery;
    }));

    // 2. QUERY DISPATCH ORDERS (Specific machines from packaging-dispatch)
    const dispatchOrderQuery = {
      company: userCompanyId
    };

    // Role-based filtering for DispatchOrder: must match salesperson's orders
    if (userRole === 'Sales' || userRole === 'Sales Employee' || (userRole !== 'Superadmin' && userRole !== 'Unit Manager' && userRole !== 'Unit Head' && userRole !== 'Sales Head')) {
      const salesOrders = await Order.find({
        companyId: userCompanyId,
        salesPerson: salespersonId
      }).select('orderCode').lean();
      const salesOrderCodes = salesOrders.map(o => o.orderCode);
      dispatchOrderQuery.orderId = { $in: salesOrderCodes };
    }

    if (status && status !== 'all') {
      if (status === 'pending') {
        dispatchOrderQuery.status = 'Ready';
      } else if (status === 'dispatched') {
        dispatchOrderQuery.status = { $in: ['Dispatched', 'In Transit'] };
      } else if (status === 'completed') {
        dispatchOrderQuery.status = { $in: ['Delivered', 'Closed'] };
      } else {
        // Status filter applies to bulk dispatches but not dispatch orders
        dispatchOrderQuery.status = '__none__';
      }
    }

    if (search) {
      dispatchOrderQuery.$or = [
        { dispatchId: { $regex: search, $options: 'i' } },
        { machineName: { $regex: search, $options: 'i' } },
        { vehicleNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const rawDispatchOrders = await DispatchOrder.find(dispatchOrderQuery).sort({ createdAt: -1 }).lean();

    const mappedDispatchOrders = await Promise.all(rawDispatchOrders.map(async (doEntry) => {
      let customerObj = null;
      if (doEntry.orderId) {
        const order = await Order.findOne({ orderCode: doEntry.orderId, companyId: userCompanyId }).populate('customer').lean();
        if (order && order.customer) {
          customerObj = {
            _id: order.customer._id,
            name: order.customer.name,
            email: order.customer.email,
            mobile: order.customer.mobile,
            city: order.customer.city,
            area: order.customer.area,
            address: order.customer.address,
            category: order.customer.category
          };
        }
      }

      if (!customerObj && doEntry.customerName) {
        customerObj = {
          name: doEntry.customerName,
          mobile: doEntry.customerContact,
          email: doEntry.customerEmail,
          address: doEntry.deliveryAddress,
          city: '',
          area: ''
        };
      }

      // Map status values to match UI classes in MyDeliveries.jsx
      let mappedStatus = 'outline';
      if (doEntry.status === 'Ready') mappedStatus = 'pending';
      else if (doEntry.status === 'Dispatched') mappedStatus = 'dispatched';
      else if (doEntry.status === 'In Transit') mappedStatus = 'dispatched';
      else if (doEntry.status === 'Delivered') mappedStatus = 'completed';
      else if (doEntry.status === 'Closed') mappedStatus = 'completed';

      const dateValue = doEntry.actualDispatchDate || doEntry.plannedDispatchDate || doEntry.createdAt;

      return {
        _id: doEntry._id,
        dcno: doEntry.dispatchId,
        date: new Date(dateValue),
        customer: customerObj,
        vehicleNumber: doEntry.vehicleNumber,
        transporterName: doEntry.transportCompanyName,
        status: mappedStatus,
        notes: doEntry.notes,
        items: [
          {
            productName: `${doEntry.machineName} (${doEntry.machineCode})`,
            quantity: 1,
            indentQty: 1,
            productId: null
          }
        ],
        totalItems: 1,
        createdAt: doEntry.createdAt
      };
    }));

    // 3. MERGE, SORT AND PAGINATE
    const allDeliveries = [...populatedBulkDeliveries, ...mappedDispatchOrders];

    // Sort by date / createdAt descending
    allDeliveries.sort((a, b) => {
      const dateA = new Date(a.date || a.createdAt);
      const dateB = new Date(b.date || b.createdAt);
      return dateB - dateA;
    });

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const total = allDeliveries.length;
    const paginated = allDeliveries.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({
      success: true,
      deliveries: paginated,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });

  } catch (error) {
    console.error('Get salesperson deliveries error:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const getSalespersonInvoices = async (req, res) => {
  try {
    const { page = 1, limit = 10, paymentStatus = '', search = '' } = req.query;
    const salespersonId = req.user._id || req.user.id;
    const userRole = req.user.role;
    const userCompanyId = req.user.companyId;

    console.log('🧾 getSalespersonInvoices (Unified) called:', {
      userId: salespersonId,
      role: userRole,
      companyId: userCompanyId
    });

    // 1. Fetch Orders for the salesperson (company isolation included)
    let orderQuery = { companyId: userCompanyId };
    if (userRole === 'Sales' || userRole === 'Sales Employee' || (userRole !== 'Superadmin' && userRole !== 'Unit Manager' && userRole !== 'Sales Head')) {
      orderQuery.salesPerson = salespersonId;
    }

    const salespersonOrders = await Order.find(orderQuery).select('_id');
    const orderIds = salespersonOrders.map(order => order._id);

    // 4. Fetch and Format Dispatches (Delivery Challans)
    // Only fetch dispatches that are 'verified', 'dispatched' or 'completed'
    let dispatchMatch = {
      company: userCompanyId,
      status: { $in: ['verified', 'dispatched', 'completed', 'approved'] },
      dcno: { $exists: true, $ne: null }
    };

    if (userRole === 'Sales' || userRole === 'Sales Employee' || (userRole !== 'Superadmin' && userRole !== 'Unit Manager' && userRole !== 'Sales Head')) {
      dispatchMatch.salesPerson = salespersonId;
    }

    if (search) {
      dispatchMatch.dcno = { $regex: search, $options: 'i' };
    }

    // Get basic dispatch info to help find associated Sales records
    const salespersonDispatches = await Dispatch.find(dispatchMatch).select('_id dcno').lean();
    const salespersonDispatchIds = salespersonDispatches.map(d => d._id);
    const salespersonDCNumbers = salespersonDispatches.map(d => d.dcno);

    // 2. Build filter query for existing Sale records (BROADENED)
    let saleQuery = {
      companyId: userCompanyId,
      $or: [
        { order: { $in: orderIds } },
        { dispatch: { $in: salespersonDispatchIds } },
        { invoiceNumber: { $in: salespersonDCNumbers } }
      ]
    };

    // Also include common prefixes if they exist in the DB
    const prefixedDCNumbers = salespersonDCNumbers.map(n => `INV-${n}`);
    saleQuery.$or.push({ invoiceNumber: { $in: prefixedDCNumbers } });

    if (paymentStatus) {
      saleQuery.paymentStatus = paymentStatus;
    }
    if (search) {
      saleQuery.$or = saleQuery.$or || [];
      saleQuery.$or.push({ invoiceNumber: { $regex: search, $options: 'i' } });
    }

    // 3. Get existing Sale records
    const sales = await Sale.find(saleQuery)
      .populate('order', 'orderCode')
      .populate('customer', 'name email mobile gstin customerCode')
      .lean();

    // Track which dispatches are already formally invoiced
    const invoicedDispatchIds = sales.filter(s => s.dispatch).map(s => s.dispatch.toString());
    const invoicedDCNumbers = sales.map(s => s.invoiceNumber.replace(/^INV-/, '')); // Normalize for matching

    // Aggregate dispatches into "invoice-like" groups by dcno
    const dispatchInvoicesRaw = await Dispatch.aggregate([
      { $match: dispatchMatch },
      {
        $lookup: {
          from: 'items',
          localField: 'productId',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$dcno',
          invoiceNumber: { $first: '$dcno' },
          customer: { $first: '$customer' },
          order: { $first: '$orderId' },
          saleDate: { $first: { $ifNull: ['$date', '$createdAt'] } },
          createdAt: { $first: '$createdAt' },
          paymentStatus: { $first: 'Pending' },
          dispatchId: { $first: '$_id' },
          totalAmount: {
            $sum: { $multiply: ['$dispatchedQuantitySentToday', { $ifNull: ['$product.salePrice', 0] }] }
          },
          items: {
            $push: {
              productName: '$productName',
              quantity: '$dispatchedQuantitySentToday',
              unitPrice: { $ifNull: ['$product.salePrice', 0] },
              totalPrice: { $multiply: ['$dispatchedQuantitySentToday', { $ifNull: ['$product.salePrice', 0] }] }
            }
          }
        }
      }
    ]);

    // Format Dispatches and filter out those already in 'sales'
    const pendingDispatches = [];
    for (const dInv of dispatchInvoicesRaw) {
      // Robust check: Skip if this DC number (normalized) exists in the Sales list
      const normalizedInvNo = dInv.invoiceNumber.replace(/^INV-/, '');
      const isAlreadyInvoiced = sales.some(s => s.invoiceNumber === dInv.invoiceNumber) ||
        invoicedDCNumbers.includes(normalizedInvNo) ||
        invoicedDispatchIds.includes(dInv.dispatchId.toString());

      if (!isAlreadyInvoiced) {
        // Populate customer info (Aggregation doesn't populate nested models easily)
        const customer = await Customer.findById(dInv.customer).select('name email mobile gstin customerCode').lean();
        const order = dInv.order ? await Order.findById(dInv.order).select('orderCode').lean() : null;

        pendingDispatches.push({
          _id: `pending_${dInv._id}`,
          invoiceNumber: dInv.invoiceNumber,
          customer: customer,
          order: order,
          totalAmount: dInv.totalAmount,
          paidAmount: 0,
          balanceAmount: dInv.totalAmount,
          saleDate: dInv.saleDate,
          createdAt: dInv.createdAt,
          paymentStatus: 'Pending',
          items: dInv.items,
          isDispatchOriginal: true
        });
      }
    }

    // 5. Combine and Paginate
    const allInvoices = [...sales, ...pendingDispatches]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Filter by paymentStatus if requested (pending dispatches are always 'Pending')
    let filteredInvoices = allInvoices;
    if (paymentStatus && paymentStatus !== 'all') {
      filteredInvoices = allInvoices.filter(inv => inv.paymentStatus === paymentStatus);
    }

    const total = filteredInvoices.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedInvoices = filteredInvoices.slice(skip, skip + parseInt(limit));

    // 6. Calculate Stats (on full filtered set)
    const stats = filteredInvoices.reduce((acc, inv) => {
      acc.totalAmount += (inv.totalAmount || 0);
      acc.paidAmount += (inv.paidAmount || 0);
      acc.balanceAmount += ((inv.totalAmount || 0) - (inv.paidAmount || 0));
      if (inv.paymentStatus === 'Overdue') acc.overdueCount += 1;
      return acc;
    }, { totalAmount: 0, paidAmount: 0, balanceAmount: 0, overdueCount: 0 });

    res.json({
      success: true,
      invoices: paginatedInvoices,
      stats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get salesperson invoices error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

/**
 * Downloads a professional Tax Invoice PDF for a given Sale or Dispatch record
 */
export const downloadInvoicePDF = async (req, res) => {
  try {
    const { id } = req.params;
    const userCompanyId = req.user.companyId;

    // 1. Fetch Sale record with all relevant details
    const sale = await Sale.findById(id)
      .populate('customer')
      .populate('order', 'orderCode')
      .populate('dispatch')
      .populate('companyId')
      .lean();

    if (!sale) {
      // If it's not a Sale ID, check if it's a Dispatch ID (for 'Pending' dispatches)
      const dispatch = await Dispatch.findById(id)
        .populate('customer')
        .populate('orderId', 'orderCode')
        .populate('productId')
        .lean();

      if (!dispatch) {
        return res.status(404).json({ success: false, message: 'Invoice not found' });
      }

      // Map Dispatch to PDF invoice format
      const company = await Company.findById(userCompanyId || dispatch.company).lean();

      const invoiceData = {
        company: company || {},
        customer: dispatch.customer || {},
        invoiceNo: dispatch.dcno,
        date: new Date(dispatch.date || dispatch.createdAt).toLocaleDateString('en-IN'),
        ref: dispatch.salesPersonName || '',
        notes: dispatch.notes || '',
        items: [{
          productName: dispatch.productId?.name || dispatch.productName || 'Product',
          hsn: dispatch.productId?.hsn || '',
          quantity: dispatch.qtyIssued || dispatch.indentQty || 0,
          unit: dispatch.productId?.unit || 'nos',
          rate: dispatch.productId?.salePrice || dispatch.rate || 0,
          discount: 0,
          mrp: dispatch.productId?.salePrice || dispatch.rate || 0
        }]
      };

      return await generateStandardizedInvoicePDF(res, invoiceData);
    }

    // 2. Fetch Company details
    const company = sale.companyId || await Company.findById(userCompanyId).lean();

    // 3. Map Sale items to PDF items format
    const items = (sale.items || []).map(item => ({
      productName: item.productName || 'Product',
      hsn: item.hsn || '',
      quantity: item.quantity || 0,
      unit: item.unit || 'nos',
      rate: item.unitPrice || item.rate || 0,
      discount: item.discount || 0,
      mrp: item.mrp || item.unitPrice || 0
    }));

    // 4. Generate PDF
    const invoiceData = {
      company: company || {},
      customer: sale.customer || {},
      invoiceNo: sale.invoiceNumber,
      date: new Date(sale.saleDate || sale.createdAt).toLocaleDateString('en-IN'),
      ref: sale.order?.orderCode || '',
      notes: sale.notes || '',
      items: items
    };

    await generateStandardizedInvoicePDF(res, invoiceData);

  } catch (error) {
    console.error('❌ Error downloading invoice PDF:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to generate PDF', error: error.message });
    }
  }
};

export const getSalespersonRefundReturns = async (req, res) => {
  try {
    const { page = 1, limit = 10, status = '', search = '' } = req.query;
    const salespersonId = req.user._id || req.user.id;
    const userRole = req.user.role;
    const userCompanyId = req.user.companyId;

    console.log('🔄 getSalespersonRefundReturns called:', {
      userId: salespersonId,
      role: userRole,
      companyId: userCompanyId
    });

    // Find orders by role-based filtering with company isolation
    let orderQuery = {};

    // Always filter by company for data isolation
    if (userCompanyId) {
      orderQuery.companyId = userCompanyId;
    }

    // If user is Sales or Sales Employee role, only show their returns
    if (userRole === 'Sales' || userRole === 'Sales Employee') {
      orderQuery.salesPerson = salespersonId;
    }
    // Unit Manager and Sales Head can see all returns from their company
    // Super Admin can see all returns
    else if (userRole !== 'Superadmin' && userRole !== 'Unit Manager' && userRole !== 'Sales Head') {
      orderQuery.salesPerson = salespersonId;
    }

    const salespersonOrders = await Order.find(orderQuery).select('_id');
    const orderIds = salespersonOrders.map(order => order._id);

    // Build filter query for returns related to orders  
    let query = { order: { $in: orderIds } };

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { returnCode: { $regex: search, $options: 'i' } },
        { reason: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let refundReturns = [];
    let total = 0;

    // Check if Return model exists and has documents
    try {
      refundReturns = await Return.find(query)
        .populate('order', 'orderCode orderDate')
        .populate('customer', 'name email mobile')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      total = await Return.countDocuments(query);
    } catch (returnError) {
      console.log('Return model not found or empty, returning empty results');
      refundReturns = [];
      total = 0;
    }

    res.json({
      success: true,
      refundReturns,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get salesperson refund returns error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Get returns for salesperson (filtered by type and company)
export const getSalespersonReturns = async (req, res) => {
  try {
    const { page = 1, limit = 10, status = '', search = '' } = req.query;

    console.log('🔄 getSalespersonReturns called - getting all returns');

    // Simple query - just get returns by type
    let query = { type: 'refund' };

    if (status && status !== 'all') {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { returnCode: { $regex: search, $options: 'i' } },
        { reason: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let returns = [];
    let total = 0;

    try {
      returns = await Return.find(query)
        .populate('order', 'orderCode orderDate')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      total = await Return.countDocuments(query);
    } catch (returnError) {
      console.log('Return model error:', returnError);
      returns = [];
      total = 0;
    }

    res.json({
      success: true,
      returns,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get salesperson returns error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Get damages for salesperson (filtered by type and company)
export const getSalespersonDamages = async (req, res) => {
  try {
    const { page = 1, limit = 10, status = '', search = '' } = req.query;

    console.log('🔄 getSalespersonDamages called - getting all damages');

    // Simple query - just get damages by type
    let query = { type: 'damage' };

    if (status && status !== 'all') {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { returnCode: { $regex: search, $options: 'i' } },
        { reason: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let damages = [];
    let total = 0;

    try {
      damages = await Return.find(query)
        .populate('order', 'orderCode orderDate')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      total = await Return.countDocuments(query);
    } catch (returnError) {
      console.log('Return model error:', returnError);
      damages = [];
      total = 0;
    }

    res.json({
      success: true,
      damages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get salesperson damages error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Get items for salesperson (filtered by company location)
export const getSalespersonItems = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const userCompanyId = req.user.companyId;

    const {
      page = 1,
      limit = 20,
      search,
      type,
      group,
      category,
      subCategory,
      lowStock,
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query;

    // Remove pagination - show all items for sales users
    const skip = 0; // No skip for sales
    const actualLimit = 0; // No limit for sales
    let query = {};

    // Company location filtering - only show items from same company
    if (userRole === 'Sales' || userRole === 'Sales Employee' || userRole === 'Sales Head' || userRole === 'Unit Manager' || userRole === 'Unit Head') {
      if (userCompanyId) {
        query.store = userCompanyId;
      } else {
        // If no company assigned, return empty results
        return res.json({
          success: true,
          items: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: 0,
            pages: 0
          },
          message: 'No company assigned to user'
        });
      }
    }
    // Super Admin can see all items (no filtering)

    // IMPORTANT: Only show items with type = "Product" for sales orders
    query.type = "Product";

    // Search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Type filter (override to ensure only Product type)
    if (type && type !== "Product") {
      console.log(`🚫 Sales API: Overriding type filter ${type} to Product`);
    }
    // Force type to be Product regardless of query parameter

    // Group filter
    if (group) {
      query.group = group;
    }

    // Category filter
    if (category) {
      query.category = category;
    }

    // Subcategory filter
    if (subCategory) {
      query.subCategory = subCategory;
    }

    // Low stock filter
    if (lowStock === 'true') {
      query.$expr = { $lte: ['$qty', '$minStock'] };
    }

    // Sort options - default to category A-Z for sales items
    let sortOptions = { category: 1, name: 1 }; // Default: category A-Z, then name A-Z

    if (sortBy && sortBy !== 'createdAt') {
      if (sortBy === 'name') {
        sortOptions.name = sortOrder === 'desc' ? -1 : 1;
      } else if (sortBy === 'code') {
        sortOptions.code = sortOrder === 'desc' ? -1 : 1;
      } else if (sortBy === 'category') {
        sortOptions.category = sortOrder === 'desc' ? -1 : 1;
      } else if (sortBy === 'qty') {
        sortOptions.qty = sortOrder === 'desc' ? -1 : 1;
      }
    }

    const items = await Item.find(query)
      .sort(sortOptions);
    // No skip or limit - return all items

    // Resolve company names for store locations
    const itemsWithCompanyNames = await Promise.all(
      items.map(async (item) => {
        const itemObj = item.toObject();

        // If store field contains an ObjectId, resolve the company name
        if (itemObj.store && itemObj.store.match(/^[0-9a-fA-F]{24}$/)) {
          try {
            const company = await Company.findById(itemObj.store).select('name city state');
            if (company) {
              itemObj.storeLocation = `${company.name} - ${company.city}, ${company.state}`;
              itemObj.companyId = itemObj.store;
            } else {
              itemObj.storeLocation = 'Unknown Location';
            }
          } catch (error) {
            console.error('Error resolving company for item:', item._id, error);
            itemObj.storeLocation = itemObj.store;
          }
        } else {
          // For backward compatibility with string store names
          itemObj.storeLocation = itemObj.store || 'No Location';
        }

        return itemObj;
      })
    );

    const total = await Item.countDocuments(query);

    res.json({
      success: true,
      items: itemsWithCompanyNames,
      pagination: {
        page: 1,
        limit: total, // Show actual total as limit
        total,
        pages: 1 // Only one page since all items are shown
      }
    });
  } catch (error) {
    console.error('Get salesperson items error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const createSalespersonItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const userCompanyId = req.user.companyId;

    const {
      name,
      code,
      group,
      category,
      subCategory,
      unit,
      salePrice,
      dealerPrice,
      hsn,
      gst,
      currency,
      unitType,
      description,
      uses,
      otherInfo,
      specifications,
      minOrderQty,
      variant // Optional field
    } = req.body;

    if (!name || !code || !category || !unit) {
      return res.status(400).json({
        success: false,
        message: 'Required fields are missing'
      });
    }

    // Check if item code already exists
    const existingItem = await Item.findOne({ code });
    if (existingItem) {
      return res.status(400).json({
        success: false,
        message: 'Product code already exists'
      });
    }

    // Handle file uploads
    let imagePath = null;
    let brochurePath = null;

    if (req.files) {
      if (req.files['image'] && req.files['image'][0]) {
        imagePath = `/uploads/items/images/${req.files['image'][0].filename}`;
      }
      if (req.files['brochure'] && req.files['brochure'][0]) {
        brochurePath = `/uploads/items/brochures/${req.files['brochure'][0].filename}`;
      }
    }

    const newItem = new Item({
      name,
      code,
      group,
      category,
      subCategory,
      unit,
      salePrice,
      dealerPrice,
      hsn,
      gst,
      currency,
      unitType,
      description,
      uses,
      otherInfo,
      specifications: Array.isArray(specifications) ? specifications : [],
      minOrderQty,
      variant,
      type: "Product", // Default for sales module
      store: userCompanyId, // Store under the user's company
      qty: 0, // Initial qty is 0
      image: imagePath,
      brochureUrl: brochurePath
    });

    await newItem.save();

    res.status(201).json({
      success: true,
      message: 'Product added successfully',
      item: newItem
    });

  } catch (error) {
    console.error('Create salesperson item error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Sales-specific order functions moved from orderController
export const getSalesSummary = async (req, res) => {
  try {
    const salespersonId = req.user._id || req.user.id;
    const userCompanyId = req.user.companyId;

    console.log('📊 getSalesSummary called:', {
      userId: salespersonId,
      role: req.user.role,
      companyId: userCompanyId
    });

    // Filter by salesperson only for salesperson roles
    const filter = {
      companyId: userCompanyId
    };
    if (req.user.role === 'Sales' || req.user.role === 'Sales Employee') {
      filter.salesPerson = salespersonId;
    }

    const [totalOrders, pendingOrders, completedOrders, approvedOrders, inProgressOrders] = await Promise.all([
      Order.countDocuments(filter),
      Order.countDocuments({ ...filter, status: { $in: ['pending', 'Pending'] } }),
      Order.countDocuments({ ...filter, status: { $in: ['completed', 'Completed'] } }),
      Order.countDocuments({ ...filter, status: { $in: ['approved', 'Approved'] } }),
      Order.countDocuments({ ...filter, status: { $in: ['in_production', 'In_Production'] } })
    ]);

    const revenueResult = await Order.aggregate([
      { $match: { ...filter, status: { $in: ['completed', 'Completed', 'approved', 'Approved'] } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    const totalRevenue = revenueResult[0]?.total || 0;

    console.log('📊 Sales Summary Results:', {
      totalOrders,
      pendingOrders,
      completedOrders,
      approvedOrders,
      inProgressOrders,
      totalRevenue,
      filter
    });

    res.json({
      success: true,
      data: {
        totalOrders,
        pendingOrders,
        completedOrders,
        approvedOrders,
        inProgressOrders,
        totalRevenue
      }
    });

  } catch (error) {
    console.error('Error in getSalesSummary:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getSalesRecentOrders = async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const salespersonId = req.user._id || req.user.id;
    const userCompanyId = req.user.companyId;

    console.log('📋 getSalesRecentOrders called:', {
      userId: salespersonId,
      role: req.user.role,
      companyId: userCompanyId,
      limit
    });

    const filter = {
      companyId: userCompanyId
    };
    if (req.user.role === 'Sales' || req.user.role === 'Sales Employee') {
      filter.salesPerson = salespersonId;
    }

    const recentOrders = await Order.find(filter)
      .populate('customer', 'name contactPerson email mobile')
      .populate('salesPerson', 'fullName username')
      .populate('products.product', 'name code category')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    // Transform orders to ensure frontend compatibility
    const transformedOrders = recentOrders.map(order => ({
      _id: order._id,
      orderCode: order.orderCode,
      customer: order.customer ? {
        _id: order.customer._id,
        name: order.customer.name,
        contactPerson: order.customer.contactPerson,
        email: order.customer.email,
        mobile: order.customer.mobile
      } : null,
      customerName: order.customer?.name || 'Unknown Customer',
      salesPerson: order.salesPerson ? {
        _id: order.salesPerson._id,
        username: order.salesPerson.username,
        fullName: order.salesPerson.fullName
      } : null,
      status: order.status || 'pending',
      totalAmount: order.totalAmount || 0,
      amount: order.totalAmount || 0,  // Frontend expects 'amount' field
      orderDate: order.orderDate,
      date: order.orderDate || order.createdAt,  // Frontend expects 'date' field  
      createdAt: order.createdAt,
      products: order.products || [],
      items: Array.isArray(order.products) ? order.products.length : 0,  // Frontend expects 'items' count
      totalQuantity: Array.isArray(order.products) ?
        order.products.reduce((sum, p) => sum + (p.quantity || 0), 0) : 0,
      totalItems: Array.isArray(order.products) ? order.products.length : 0,
      notes: order.notes
    }));

    console.log('📋 Recent Orders Results:', {
      count: transformedOrders.length,
      orders: transformedOrders.map(order => ({
        id: order._id,
        orderCode: order.orderCode,
        customer: order.customerName,
        status: order.status,
        totalAmount: order.totalAmount
      }))
    });

    res.json({
      success: true,
      orders: transformedOrders,  // Changed from 'data' to 'orders' to match frontend expectation
      count: transformedOrders.length
    });

  } catch (error) {
    console.error('Error in getSalesRecentOrders:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

export const getSalesOrders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = '',
      startDate = '',
      endDate = '',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const salespersonId = req.user._id || req.user.id;
    const userCompanyId = req.user.companyId;

    console.log('📦 getSalesOrders called:', {
      userId: salespersonId,
      role: req.user.role,
      companyId: userCompanyId,
      params: { page, limit, search, status, startDate, endDate }
    });

    // Filter by salesperson only for salesperson roles
    const filter = {
      companyId: userCompanyId
    };
    if (req.user.role === 'Sales' || req.user.role === 'Sales Employee') {
      filter.salesPerson = salespersonId;
    }

    if (search) {
      filter.$or = [
        { orderCode: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } }
      ];
    }

    if (status) {
      filter.status = status;
    }

    if (startDate || endDate) {
      filter.orderDate = {};
      if (startDate) {
        filter.orderDate.$gte = new Date(startDate);
      }
      if (endDate) {
        filter.orderDate.$lte = new Date(endDate);
      }
    }

    const validSortFields = ['createdAt', 'orderDate', 'totalAmount', 'orderCode', 'status'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortDirection = sortOrder === 'asc' ? 1 : -1;

    const skip = (page - 1) * limit;
    const limitNum = Math.min(parseInt(limit), 100);

    console.log('📦 Sales Orders Filter:', filter);

    const [orders, totalOrders] = await Promise.all([
      Order.find(filter)
        .populate('customer', 'name contactPerson email mobile address city state')
        .populate('salesPerson', 'fullName username email role')
        .populate('products.product', 'name code category salePrice brand')
        .sort({ [sortField]: sortDirection })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Order.countDocuments(filter)
    ]);

    // Transform orders for frontend compatibility
    const transformedOrders = orders.map(order => ({
      _id: order._id,
      orderCode: order.orderCode,
      customer: order.customer ? {
        _id: order.customer._id,
        name: order.customer.name,
        contactPerson: order.customer.contactPerson,
        email: order.customer.email,
        mobile: order.customer.mobile,
        address: order.customer.address,
        city: order.customer.city,
        state: order.customer.state
      } : null,
      customerName: order.customer?.name || 'Unknown Customer',
      salesPerson: order.salesPerson ? {
        _id: order.salesPerson._id,
        username: order.salesPerson.username,
        fullName: order.salesPerson.fullName,
        email: order.salesPerson.email,
        role: order.salesPerson.role
      } : null,
      status: order.status || 'pending',
      totalAmount: order.totalAmount || 0,
      orderDate: order.orderDate,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      products: order.products || [],
      totalQuantity: Array.isArray(order.products) ?
        order.products.reduce((sum, p) => sum + (p.quantity || 0), 0) : 0,
      totalItems: Array.isArray(order.products) ? order.products.length : 0,
      notes: order.notes,
      unit: order.unit,
      companyId: order.companyId
    }));

    const totalPages = Math.ceil(totalOrders / limitNum);

    console.log('📦 Sales Orders Results:', {
      totalOrders,
      currentPage: page,
      totalPages,
      ordersReturned: transformedOrders.length,
      sampleOrder: transformedOrders[0] ? {
        orderCode: transformedOrders[0].orderCode,
        customer: transformedOrders[0].customerName,
        totalAmount: transformedOrders[0].totalAmount
      } : null
    });

    res.json({
      success: true,
      data: {
        orders: transformedOrders,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalOrders,
          hasNextPage: parseInt(page) < totalPages,
          hasPrevPage: parseInt(page) > 1
        }
      }
    });

  } catch (error) {
    console.error('Error in getSalesOrders:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get priority products for a sales user
export const getPriorityProducts = async (req, res) => {
  try {
    console.log('🚀 Getting priority products for user:', req.user._id, req.user.role);

    // Only allow Sales users or Super Users
    if (!['Sales', 'sales', 'SALES', 'Sales Head', 'Sales Employee', 'Super User'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied - Sales role required'
      });
    }

    const { page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;

    // Get user's priority products
    const priorityProducts = await PriorityProduct.find({
      userId: req.user._id,
      companyId: req.user.companyId,
      isActive: true
    })
      .populate({
        path: 'productId',
        select: 'name code category subCategory price stock image unit'
      })
      .sort({ priority: -1, lastUsed: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const totalCount = await PriorityProduct.countDocuments({
      userId: req.user._id,
      companyId: req.user.companyId,
      isActive: true
    });

    // Format the response
    const formattedProducts = priorityProducts.map(pp => ({
      id: pp._id,
      priorityId: pp._id,
      productId: pp.productId?._id,
      name: pp.productId?.name || 'Unknown Product',
      code: pp.productId?.code || 'N/A',
      category: pp.productId?.category || 'N/A',
      subCategory: pp.productId?.subCategory || '',
      price: pp.productId?.price || 0,
      stock: pp.productId?.stock || 0,
      image: pp.productId?.image || '',
      unit: pp.productId?.unit || 'pcs',
      priority: pp.priority,
      usageCount: pp.usageCount,
      lastUsed: pp.lastUsed,
      isPriority: true
    }));

    console.log(`✅ Found ${formattedProducts.length} priority products for user`);

    res.json({
      success: true,
      message: 'Priority products retrieved successfully',
      data: {
        products: formattedProducts,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(totalCount / limit)
        }
      }
    });

  } catch (error) {
    console.error('Error getting priority products:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get priority products',
      error: error.message
    });
  }
};

// Add product to priority list
export const addPriorityProduct = async (req, res) => {
  try {
    console.log('🚀 Adding priority product for user:', req.user._id);
    console.log('Request body:', req.body);

    // Only allow Sales users or Super Users
    if (!['Sales', 'sales', 'SALES', 'Sales Head', 'Sales Employee', 'Super User'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied - Sales role required'
      });
    }

    const { productId, priority = 1 } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }

    // Check if product exists and belongs to user's company
    const product = await Item.findOne({
      _id: productId,
      store: req.user.companyId
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or not accessible'
      });
    }

    // Check if already in priority list
    const existingPriority = await PriorityProduct.findOne({
      userId: req.user._id,
      productId,
      companyId: req.user.companyId
    });

    if (existingPriority) {
      if (existingPriority.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Product is already in your priority list'
        });
      } else {
        // Reactivate if it was deactivated
        existingPriority.isActive = true;
        existingPriority.priority = priority;
        await existingPriority.save();

        return res.json({
          success: true,
          message: 'Product reactivated in priority list',
          data: existingPriority
        });
      }
    }

    // Create new priority product
    const priorityProduct = new PriorityProduct({
      userId: req.user._id,
      companyId: req.user.companyId,
      productId,
      priority: Math.min(Math.max(priority, 1), 10), // Ensure priority is between 1-10
      usageCount: 0
    });

    await priorityProduct.save();

    // Populate product details for response
    await priorityProduct.populate('productId', 'name code category price');

    console.log('✅ Priority product added successfully:', priorityProduct._id);

    res.status(201).json({
      success: true,
      message: 'Product added to priority list successfully',
      data: priorityProduct
    });

  } catch (error) {
    console.error('Error adding priority product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add priority product',
      error: error.message
    });
  }
};

// Remove product from priority list
export const removePriorityProduct = async (req, res) => {
  try {
    console.log('🚀 Removing priority product:', req.params.id, 'for user:', req.user._id);

    // Only allow Sales users or Super Users
    if (!['Sales', 'sales', 'SALES', 'Sales Head', 'Sales Employee', 'Super User'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied - Sales role required'
      });
    }

    const { id: priorityProductId } = req.params;

    // Find and verify ownership
    const priorityProduct = await PriorityProduct.findOne({
      _id: priorityProductId,
      userId: req.user._id,
      companyId: req.user.companyId
    });

    if (!priorityProduct) {
      return res.status(404).json({
        success: false,
        message: 'Priority product not found or not accessible'
      });
    }

    // Soft delete by setting isActive to false
    priorityProduct.isActive = false;
    await priorityProduct.save();

    console.log('✅ Priority product removed successfully');

    res.json({
      success: true,
      message: 'Product removed from priority list successfully'
    });

  } catch (error) {
    console.error('Error removing priority product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove priority product',
      error: error.message
    });
  }
};

// Update priority product usage (called when product is used in order)
export const updatePriorityProductUsage = async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }

    // Find priority product and update usage
    const priorityProduct = await PriorityProduct.findOne({
      userId: req.user._id,
      productId,
      companyId: req.user.companyId,
      isActive: true
    });

    if (priorityProduct) {
      await priorityProduct.markAsUsed();
      console.log('✅ Updated priority product usage for:', productId);
    }

    res.json({
      success: true,
      message: 'Priority product usage updated'
    });

  } catch (error) {
    console.error('Error updating priority product usage:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update priority product usage',
      error: error.message
    });
  }
};

// Get cutoff time status for sales persons
export const getSalesCutoffTimeStatus = async (req, res) => {
  try {
    const salesPerson = req.user;

    console.log('🕐 Getting cutoff time status for sales person:', salesPerson.username);

    // Validation
    if (!salesPerson.companyId) {
      return res.status(400).json({
        success: false,
        message: 'Sales person is not assigned to any company. Please contact system administrator.'
      });
    }

    // Get current order status for the company
    const orderStatus = await CutoffTime.canPlaceOrder(salesPerson.companyId);

    // Get cutoff time setting for additional details
    const cutoffSetting = await CutoffTime.findOne({ companyId: salesPerson.companyId });

    console.log('✅ Cutoff time status retrieved:', {
      allowed: orderStatus.allowed,
      cutoffTime: cutoffSetting?.cutoffTime || null,
      isActive: cutoffSetting?.isActive || false
    });

    res.json({
      success: true,
      data: {
        allowed: orderStatus.allowed,
        message: orderStatus.message,
        cutoffTime: cutoffSetting?.cutoffTime || null,
        isActive: cutoffSetting?.isActive || false,
        isPastCutoff: orderStatus.isPastCutoff || false,
        description: cutoffSetting?.description || null
      }
    });

  } catch (error) {
    console.error('Error getting cutoff time status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cutoff time status',
      error: error.message
    });
  }
};

// Create return for salesperson (with automatic company/salesperson association)
export const createSalespersonReturn = async (req, res) => {
  try {
    const salespersonId = req.user._id || req.user.id;
    const userRole = req.user.role;
    const userCompanyId = req.user.companyId;

    console.log('🔄 createSalespersonReturn called:', {
      userId: salespersonId,
      role: userRole,
      companyId: userCompanyId,
      body: req.body
    });

    // Prepare return data with automatic associations
    const returnData = {
      ...req.body,
      companyId: userCompanyId, // Auto-associate with user's company
      salesPerson: salespersonId, // Auto-associate with current salesperson
      createdBy: salespersonId
    };

    // If order ID is provided, fetch order to get orderDate
    if (req.body.order) {
      try {
        const orderDoc = await Order.findById(req.body.order);
        if (orderDoc) {
          returnData.orderDate = orderDoc.orderDate || orderDoc.createdAt;
          console.log(`✅ Linked orderDate found: ${returnData.orderDate}`);
        }
      } catch (err) {
        console.error('Error fetching order for return date:', err);
      }
    }

    const newReturn = new Return(returnData);
    const savedReturn = await newReturn.save();

    res.status(201).json({
      success: true,
      message: 'Return created successfully',
      return: savedReturn
    });
  } catch (error) {
    console.error('Create salesperson return error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create return',
      error: error.message
    });
  }
};

// Update return for salesperson
export const updateSalespersonReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const salespersonId = req.user._id || req.user.id;
    const userRole = req.user.role;
    const userCompanyId = req.user.companyId;

    console.log('🔄 updateSalespersonReturn called:', {
      returnId: id,
      userId: salespersonId,
      role: userRole,
      companyId: userCompanyId
    });

    // More flexible access control - try to find the return first
    let findQuery = { _id: id };

    // Only apply company filtering if user has a companyId
    if (userCompanyId) {
      findQuery.$or = [
        { companyId: userCompanyId },
        { companyId: { $exists: false } }, // Allow records without companyId
        { companyId: null }
      ];
    }

    // Additional role-based filtering only for Sales and Sales Employee roles
    if (userRole === 'Sales' || userRole === 'Sales Employee') {
      // For sales users, also allow returns they created or are assigned to
      findQuery.$and = findQuery.$and || [];
      findQuery.$and.push({
        $or: [
          { salesPerson: salespersonId },
          { createdBy: salespersonId },
          { salesPerson: { $exists: false } }, // Allow records without salesPerson
          { salesPerson: null }
        ]
      });
    }

    console.log('🔍 Update query:', JSON.stringify(findQuery, null, 2));

    const updatedReturn = await Return.findOneAndUpdate(
      findQuery,
      {
        ...req.body,
        updatedBy: salespersonId,
        // Ensure these fields are set if missing
        companyId: req.body.companyId || userCompanyId,
        salesPerson: req.body.salesPerson || salespersonId
      },
      { new: true, runValidators: true }
    );

    if (!updatedReturn) {
      return res.status(404).json({
        success: false,
        message: 'Return not found or access denied'
      });
    }

    res.json({
      success: true,
      message: 'Return updated successfully',
      return: updatedReturn
    });
  } catch (error) {
    console.error('Update salesperson return error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update return',
      error: error.message
    });
  }
};

// Create damage for salesperson (with automatic company/salesperson association)
export const createSalespersonDamage = async (req, res) => {
  try {
    const salespersonId = req.user._id || req.user.id;
    const userRole = req.user.role;
    const userCompanyId = req.user.companyId;

    console.log('🔄 createSalespersonDamage called:', {
      userId: salespersonId,
      role: userRole,
      companyId: userCompanyId,
      body: req.body
    });

    // Prepare damage data with automatic associations
    const damageData = {
      ...req.body,
      companyId: userCompanyId, // Auto-associate with user's company
      salesPerson: salespersonId, // Auto-associate with current salesperson
      createdBy: salespersonId
    };

    // If order ID is provided, fetch order to get orderDate
    if (req.body.order) {
      try {
        const orderDoc = await Order.findById(req.body.order);
        if (orderDoc) {
          damageData.orderDate = orderDoc.orderDate || orderDoc.createdAt;
          console.log(`✅ Linked orderDate found for damage: ${damageData.orderDate}`);
        }
      } catch (err) {
        console.error('Error fetching order for damage return date:', err);
      }
    }

    const newDamage = new Return(damageData);
    const savedDamage = await newDamage.save();

    res.status(201).json({
      success: true,
      message: 'Damage created successfully',
      damage: savedDamage
    });
  } catch (error) {
    console.error('Create salesperson damage error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create damage',
      error: error.message
    });
  }
};

// Update damage for salesperson
export const updateSalespersonDamage = async (req, res) => {
  try {
    const { id } = req.params;
    const salespersonId = req.user._id || req.user.id;
    const userRole = req.user.role;
    const userCompanyId = req.user.companyId;

    console.log('🔄 updateSalespersonDamage called:', {
      damageId: id,
      userId: salespersonId,
      role: userRole,
      companyId: userCompanyId
    });

    // Find damage with proper access control
    let findQuery = { _id: id };

    // Company filtering
    if (userCompanyId) {
      findQuery.companyId = userCompanyId;
    }

    // Role-based filtering
    if (userRole === 'Sales' || userRole === 'Sales Employee') {
      findQuery.salesPerson = salespersonId;
    }

    const updatedDamage = await Return.findOneAndUpdate(
      findQuery,
      { ...req.body, updatedBy: salespersonId },
      { new: true, runValidators: true }
    );

    if (!updatedDamage) {
      return res.status(404).json({
        success: false,
        message: 'Damage not found or access denied'
      });
    }

    res.json({
      success: true,
      message: 'Damage updated successfully',
      damage: updatedDamage
    });
  } catch (error) {
    console.error('Update salesperson damage error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update damage',
      error: error.message
    });
  }
};

// Delete a return (sales-specific)
export const deleteSalespersonReturn = async (req, res) => {
  try {
    const { id } = req.params;

    console.log('🗑️ deleteSalespersonReturn called:', {
      returnId: id,
      userId: req.user._id
    });

    // Find the return first
    const returnDoc = await Return.findById(id);
    if (!returnDoc) {
      return res.status(404).json({
        success: false,
        message: 'Return not found'
      });
    }

    // Delete the return
    await Return.findByIdAndDelete(id);

    console.log('✅ Return deleted successfully');

    res.json({
      success: true,
      message: 'Return deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting return:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete return',
      error: error.message
    });
  }
};

// Delete a damage (sales-specific)
export const deleteSalespersonDamage = async (req, res) => {
  try {
    const { id } = req.params;

    console.log('🗑️ deleteSalespersonDamage called:', {
      damageId: id,
      userId: req.user._id
    });

    // Find the damage first
    const damageDoc = await Return.findById(id);
    if (!damageDoc) {
      return res.status(404).json({
        success: false,
        message: 'Damage not found'
      });
    }

    // Verify it's actually a damage type
    if (damageDoc.type !== 'damage') {
      return res.status(400).json({
        success: false,
        message: 'Document is not a damage record'
      });
    }

    // Delete the damage
    await Return.findByIdAndDelete(id);

    console.log('✅ Damage deleted successfully');

    res.json({
      success: true,
      message: 'Damage deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting damage:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete damage',
      error: error.message
    });
  }
};

// Handle sending quotation email
export const sendQuotationEmailHandler = async (req, res) => {
  console.log('📬 [API] Received request to send quotation email');
  try {
    const { to, customerName, leadCode, attachmentBase64, quotationFinalAmount } = req.body;
    const userCompanyId = req.user.companyId;

    // Fetch company name for branding
    const company = await Company.findById(userCompanyId);
    const companyName = company ? company.name : 'Samtek Machinery';

    console.log('📧 Starting email transmission via service...');
    const result = await sendQuotationEmail({
      to,
      customerName,
      leadCode,
      companyName,
      attachmentBase64
    });
    console.log('📧 Email service call completed');

    if (result.success) {
      // Save the quotation to the Lead if leadCode is provided
      if (leadCode) {
        try {
          const Lead = (await import('../models/Lead.js')).default;
          const updateFields = {
            quotation: attachmentBase64,
          };
          // Save the quotation final amount (Net Amount from PDF) so outstanding is accurate at Deal Won
          if (quotationFinalAmount && !isNaN(quotationFinalAmount) && Number(quotationFinalAmount) > 0) {
            updateFields.quotationFinalAmount = Number(quotationFinalAmount);
            console.log(`💰 Saving quotationFinalAmount: ₹${quotationFinalAmount} for lead ${leadCode}`);
          }
          await Lead.findOneAndUpdate(
            { leadCode, companyId: userCompanyId },
            {
              ...updateFields,
              $push: {
                history: {
                  action: 'Quotation Sent',
                  notes: `Quotation sent to ${to}. Final amount: ₹${quotationFinalAmount || 0}`,
                  performedBy: req.user._id,
                  timestamp: new Date()
                }
              }
            }
          );
          console.log(`💾 Saved quotation for lead ${leadCode}`);
        } catch (saveError) {
          console.error('❌ Error saving quotation to lead:', saveError);
          // Don't fail the whole request if only saving to DB fails
        }
      }
      res.json({ success: true, message: 'Quotation sent successfully' });
    } else {
      res.status(500).json({ success: false, message: 'Failed to send quotation', error: result.error });
    }
  } catch (error) {
    console.error('❌ Error in sendQuotationEmailHandler:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

