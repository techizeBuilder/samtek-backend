import Order from '../models/Order.js';
import ProductDailySummary from '../models/ProductDailySummary.js';
import { Item } from '../models/Inventory.js';
import mongoose from 'mongoose';

/**
 * Update product summary when orders change
 * @param {string} productId - Product ID
 * @param {Date} date - Order date
 * @param {string} companyId - Company ID
 */
export const updateProductSummary = async (productId, date, companyId) => {
  try {
    // Normalize date to start of day
    const summaryDate = new Date(date);
    summaryDate.setUTCHours(0, 0, 0, 0);

    // Get product details
    const product = await Item.findById(productId);
    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }

    // Aggregate total indent for this product/date/company
    const aggregationResult = await Order.aggregate([
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(companyId),
          orderDate: {
            $gte: summaryDate,
            $lt: new Date(summaryDate.getTime() + 24 * 60 * 60 * 1000) // Next day
          },
          'products.product': new mongoose.Types.ObjectId(productId),
          status: { $nin: ['cancelled', 'rejected'] } // Exclude cancelled/rejected orders
        }
      },
      {
        $unwind: '$products'
      },
      {
        $match: {
          'products.product': new mongoose.Types.ObjectId(productId)
        }
      },
      {
        $group: {
          _id: null,
          totalIndent: { $sum: '$products.quantity' }
        }
      }
    ]);

    const totalIndent = aggregationResult.length > 0 ? aggregationResult[0].totalIndent : 0;

    // Find existing summary document (IGNORE DATE - use only company+product)
    let summary = await ProductDailySummary.findOne({
      companyId: new mongoose.Types.ObjectId(companyId),
      productId: new mongoose.Types.ObjectId(productId)
    });

    if (summary) {
      // Update existing summary
      summary.totalIndent = totalIndent;
      summary.calculateFormulas();
      await summary.save();
      console.log(`Updated product summary for ${product.name} on ${summaryDate.toISOString().split('T')[0]}: totalIndent = ${totalIndent}`);
    } else {
      console.log(`No existing summary found for ${product.name} on ${summaryDate.toISOString().split('T')[0]}, skipping auto-creation`);
      return null;
    }
    
    return summary;
  } catch (error) {
    console.error('Error updating product summary:', error);
    throw error;
  }
};

/**
 * Get sales breakdown for a product on a specific date
 * @param {string} productId - Product ID
 * @param {Date} date - Date
 * @param {string} companyId - Company ID
 */
export const getSalesBreakdown = async (productIds, date, companyId) => {
  try {
    console.log(`🔍 Getting sales breakdown for ${Array.isArray(productIds) ? productIds.length : 1} products, date: ${date}, companyId: ${companyId}`);

    // Handle single productId or array of productIds
    const productIdArray = Array.isArray(productIds) ? productIds : [productIds];
    const objectIds = productIdArray.map(id => new mongoose.Types.ObjectId(id._id || id));

    // Build match filter for orders
    const matchFilter = {
      status: 'approved' // Only count approved orders for production summary
    };

    // Add company filter if provided
    if (companyId) {
      matchFilter.companyId = new mongoose.Types.ObjectId(companyId);
    }

    // Apply date filter if provided
    if (date) {
      if (date instanceof Date) {
        // Single date logic
        const filterDate = new Date(date);
        filterDate.setUTCHours(0, 0, 0, 0);
        const nextDay = new Date(filterDate.getTime() + 24 * 60 * 60 * 1000);
        
        matchFilter.orderDate = {
          $gte: filterDate,
          $lt: nextDay
        };
        console.log(`📅 Single date filter: ${filterDate.toISOString()} to ${nextDay.toISOString()}`);
      } else if (typeof date === 'object' && (date.$gte || date.$lte)) {
        // Range filter already formatted (from controller)
        matchFilter.orderDate = date;
        console.log('📅 Date range filter applied from object:', JSON.stringify(date));
      }
    } else {
      console.log(`📅 No date filter applied - getting all orders`);
    }


    console.log('🔍 Match filter for orders:', matchFilter);

    const breakdown = await Order.aggregate([
      {
        $match: matchFilter
      },
      {
        $lookup: {
          from: 'users',
          localField: 'salesPerson',
          foreignField: '_id',
          as: 'salesPersonDetails'
        }
      },
      {
        $lookup: {
          from: 'customers', 
          localField: 'customer',
          foreignField: '_id',
          as: 'customerDetails'
        }
      },
      {
        $unwind: '$products'
      },
      {
        $match: {
          'products.product': { $in: objectIds }
        }
      },
      {
        $group: {
          _id: {
            productId: '$products.product',
            salesPersonId: '$salesPerson'
          },
          productId: { $first: '$products.product' },
          salesPersonId: { $first: '$salesPerson' },
          salesPersonName: { 
            $first: { 
              $ifNull: [
                { $arrayElemAt: ['$salesPersonDetails.fullName', 0] }, 
                { $arrayElemAt: ['$salesPersonDetails.username', 0] },
                'Unknown'
              ] 
            } 
          },
          totalQuantity: { $sum: '$products.quantity' },
          orderCount: { $sum: 1 },
          orderIds: { $push: '$_id' }
        }
      },
      // Group by product to collect all salesperson data for each product
      {
        $group: {
          _id: '$productId',
          productId: { $first: '$productId' },
          salesBreakdown: {
            $push: {
              salesPersonId: '$salesPersonId',
              salesPersonName: '$salesPersonName',
              totalQuantity: '$totalQuantity',
              orderCount: '$orderCount',
              orderIds: '$orderIds'
            }
          },
          totalIndent: { $sum: '$totalQuantity' },
          totalOrderCount: { $sum: '$orderCount' }
        }
      },
      {
        $project: {
          _id: 0,
          productId: 1,
          summary: {
            totalIndent: '$totalIndent',
            orderCount: '$totalOrderCount'
          },
          salesBreakdown: 1
        }
      }
    ]);

    console.log(`📊 Sales breakdown result: ${breakdown.length} products found with salesperson data`);
    
    // Log sample data
    if (breakdown.length > 0) {
      console.log('📋 Sample breakdown:', JSON.stringify(breakdown[0], null, 2));
      console.log('📋 Full breakdown structure:', breakdown.map(b => ({
        productId: b.productId,
        salesBreakdownCount: b.salesBreakdown?.length || 0,
        totalIndent: b.summary?.totalIndent || 0
      })));
    } else {
      console.log(`📭 No orders found for products on date: ${date || 'all dates'}`);
      console.log('📋 Match filter used:', matchFilter);
    }

    return breakdown;
  } catch (error) {
    console.error('Error getting sales breakdown:', error);
    return [];
  }
};

/**
 * Initialize summary for a new product
 * @param {string} productId - Product ID
 * @param {string} productName - Product name
 * @param {string} companyId - Company ID
 */
export const initializeProductSummary = async (productId, productName, companyId) => {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // ✅ FIXED: Check for existing entry by productId + companyId ONLY (ignore date)
    const existingSummary = await ProductDailySummary.findOne({
      companyId: new mongoose.Types.ObjectId(companyId),
      productId: new mongoose.Types.ObjectId(productId)
    });

    if (existingSummary) {
      console.log(`Found existing summary for product ${productName}, updating date to today`);
      // Update the existing entry's date to today and return
      existingSummary.date = today;
      await existingSummary.save();
      return existingSummary;
    }

    // Create new summary ONLY if no entry exists for this product + company
    const summary = new ProductDailySummary({
      date: today,
      companyId: new mongoose.Types.ObjectId(companyId),
      productId: new mongoose.Types.ObjectId(productId),
      productName: productName,
      qtyPerBatch: 0,
      packing: 0,
      physicalStock: 0,
      batchAdjusted: 0,
      totalIndent: 0
    });

    summary.calculateFormulas();
    await summary.save();

    console.log(`Initialized NEW summary for product: ${productName}`);
    return summary;
  } catch (error) {
    console.error('Error initializing product summary:', error);
    throw error;
  }
};