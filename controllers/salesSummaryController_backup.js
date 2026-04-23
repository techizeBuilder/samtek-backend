import ProductDailySummary from '../models/ProductDailySummary.js';
import ProductDetailsDailySummary from '../models/ProductDetailsDailySummary.js';
import { getSalesBreakdown } from '../services/productionSummaryService.js';
import { Item } from '../models/Inventory.js';
import ProductionGroup from '../models/ProductionGroup.js';
import mongoose from 'mongoose';

/**
 * GET /api/sales/summary
 * Get daily sales summary for all products (for Sales Approval Dashboard)
 */
export const getSalesSummary = async (req, res) => {
  try {
    const { date, companyId } = req.query;
    const userRole = req.user.role;
    const userCompanyId = req.user.companyId;

    // COMMENTED OUT: Date handling removed to show all data by default
    // Date handling - if no date provided, get all data from all dates
    // let summaryDate = null;
    // if (date) {
    //   summaryDate = new Date(date);
    //   if (isNaN(summaryDate.getTime())) {
    //     return res.status(400).json({
    //       success: false,
    //       message: 'Invalid date format. Use YYYY-MM-DD'
    //     });
    //   }
    //   summaryDate.setUTCHours(0, 0, 0, 0);
    // }
    // If summaryDate is null, we'll get all dates
    
    // Show all data by default - no date filtering
    const summaryDate = null;

    // Company filtering based on user role
    let filterCompanyId;
    if (userRole === 'Unit Manager' || userRole === 'Unit Head') {
      // Unit managers can only see their company data
      if (!userCompanyId) {
        return res.status(403).json({
          success: false,
          message: 'User not assigned to any company'
        });
      }
      filterCompanyId = userCompanyId;
    } else if (userRole === 'Super Admin' && companyId) {
      // Super admin can filter by specific company
      filterCompanyId = companyId;
    } else if (userRole === 'Super Admin') {
      // Super admin sees all companies if no filter
      filterCompanyId = null;
    } else {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions to access sales summary'
      });
    }

    // Build query filter - CHANGED: Don't filter ProductDailySummary by date
    // We want to show ALL products, but filter orders by date
    const filter = {};
    // Remove date filter from ProductDailySummary query
    // if (summaryDate !== null) {
    //   filter.date = summaryDate; 
    // }
    
    // Only filter by company, not by date
    if (filterCompanyId) {
      filter.companyId = new mongoose.Types.ObjectId(filterCompanyId);
    }

    console.log('🔍 ProductDailySummary query filter (NO DATE FILTER):', filter);
    console.log('📅 Date will be applied to ORDERS only:', summaryDate);
    console.log('🏢 Filter company ID:', filterCompanyId);
    console.log('👤 User role:', userRole);
    console.log('🏢 User company ID:', userCompanyId);

    // Get all summaries for the date
    const summaries = await ProductDailySummary.find(filter)
      .populate('productId', 'name category subCategory') // Include category and subCategory
      .populate('companyId', 'name')
      .sort({ productName: 1 });

    console.log('📊 Raw summaries found:', summaries.length);
    if (summaries.length > 0) {
      console.log('📋 First few summaries:');
      summaries.slice(0, 3).forEach((s, i) => {
        console.log(`  ${i+1}. ${s.productName} | Date: ${s.date} | Company: ${s.companyId} | ProductId: ${s.productId ? 'exists' : 'NULL'}`);
      });
    } else {
      console.log('❌ No summaries found with filter:', filter);
      
      // If no summaries found for the specific date, but date was provided,
      // get all products and show them with empty sales data
      if (summaryDate !== null) {
        console.log('📅 No data for specific date, fetching all products to show with empty sales data...');
        
        // Get all unique products that have summaries in the system for this company
        const fallbackFilter = {};
        if (filterCompanyId) {
          fallbackFilter.companyId = new mongoose.Types.ObjectId(filterCompanyId);
        }
        
        const allProducts = await ProductDailySummary.find(fallbackFilter)
          .populate('productId', 'name category subCategory') // Include category and subCategory
          .populate('companyId', 'name')
          .sort({ productName: 1 });
        
        console.log(`📦 Found ${allProducts.length} total products in system`);
        
        // Create fake summaries for the requested date with empty sales data
        const fakeSummaries = [];
        const seenProducts = new Set();
        
        allProducts.forEach(product => {
          if (product.productId && product.productId._id && !seenProducts.has(product.productId._id.toString())) {
            seenProducts.add(product.productId._id.toString());
            fakeSummaries.push({
              _id: `fake-${product.productId._id}`,
              productId: product.productId,
              productName: product.productName,
              companyId: product.companyId,
              date: summaryDate, // Use the requested date
              qtyPerBatch: product.qtyPerBatch || 0,
              totalQuantity: 0, // No sales data for this date
              status: 'pending'
            });
          }
        });
        
        console.log(`📋 Created ${fakeSummaries.length} fake summaries for products with no data on ${summaryDate.toISOString().split('T')[0]}`);
        
        // Use fake summaries if we found products
        if (fakeSummaries.length > 0) {
          summaries.length = 0; // Clear original array
          summaries.push(...fakeSummaries); // Add fake summaries
        }
      }
      
      // Let's check if there are ANY records at all
      const totalRecords = await ProductDailySummary.countDocuments();
      console.log('🔍 Total ProductDailySummary records in database:', totalRecords);
      
      if (totalRecords > 0) {
        const sampleRecord = await ProductDailySummary.findOne().lean();
        console.log('📋 Sample record from database:', {
          date: sampleRecord.date,
          productName: sampleRecord.productName,
          companyId: sampleRecord.companyId,
          productId: sampleRecord.productId
        });
      }
    }

    // Format response data - filter out summaries with missing products
    console.log(`📊 Total summaries found: ${summaries.length}`);
    
    // Log summaries with null productId
    const nullProductIdSummaries = summaries.filter(summary => !summary.productId);
    if (nullProductIdSummaries.length > 0) {
      console.log(`🚨 Found ${nullProductIdSummaries.length} summaries with null productId:`);
      nullProductIdSummaries.forEach((summary, index) => {
        console.log(`  ${index + 1}. ID: ${summary._id}, ProductName: ${summary.productName}, Date: ${summary.date}`);
      });
    }
    
    const validSummaries = summaries.filter(summary => summary.productId && summary.productId._id);
    console.log(`✅ Valid summaries after filtering: ${validSummaries.length}`);
    
    const products = await Promise.all(validSummaries.map(async (summary) => {
      try {
        // Get sales breakdown using the requested date filter (not summary's date)
        let salesBreakdown = [];
        try {
          salesBreakdown = await getSalesBreakdown(
            summary.productId._id,
            date, // Use the date from request query, not summary.date
            summary.companyId._id || summary.companyId
          );
        } catch (salesError) {
          console.warn(`⚠️ Sales breakdown failed for ${summary.productName}:`, salesError.message);
          // Continue with empty salesBreakdown instead of failing completely
          salesBreakdown = [];
        }

        console.log(`📊 Sales breakdown for ${summary.productName} on ${date}:`, salesBreakdown.length, 'sales persons');

        return {
          productId: summary.productId._id,
          productName: summary.productName,
          category: summary.productId.category, // Add category
          subCategory: summary.productId.subCategory, // Add subCategory  
          qtyPerBatch: summary.qtyPerBatch,
          totalQuantity: summary.totalQuantity || 0, // ADD totalQuantity from database
          summary: {
            _id: summary._id, // Add ProductDailySummary ID for approval
            status: summary.status || 'pending', // Add status for approval workflow
            totalIndent: summary.totalIndent,
            physicalStock: summary.physicalStock,
            packing: summary.packing,
            batchAdjusted: summary.batchAdjusted,
            productionFinalBatches: summary.productionFinalBatches,
            toBeProducedDay: summary.toBeProducedDay,
            toBeProducedBatches: summary.toBeProducedBatches,
            expiryShortage: summary.expiryShortage,
            produceBatches: summary.produceBatches,
          },
          salesBreakdown: salesBreakdown
        };
      } catch (error) {
        console.error(`❌ Critical error processing summary for product ${summary.productName}:`, error);
        // Even on critical errors, return the product with empty sales data
        // instead of completely excluding it
        return {
          productId: summary.productId._id,
          productName: summary.productName,
          category: summary.productId?.category || 'Unknown', // Add category with fallback
          subCategory: summary.productId?.subCategory || '', // Add subCategory with fallback
          qtyPerBatch: summary.qtyPerBatch,
          totalQuantity: summary.totalQuantity || 0,
          summary: {
            _id: summary._id,
            status: summary.status || 'pending',
            totalIndent: summary.totalIndent || 0,
            physicalStock: summary.physicalStock || 0,
            packing: summary.packing || 0,
            batchAdjusted: summary.batchAdjusted || 0,
            productionFinalBatches: summary.productionFinalBatches || 0,
            toBeProducedDay: summary.toBeProducedDay || 0,
            toBeProducedBatches: summary.toBeProducedBatches || 0,
            expiryShortage: summary.expiryShortage || 0,
            produceBatches: summary.produceBatches || 0,
          },
          salesBreakdown: []
        };
      }
    }));

    // All products should now be valid since we handle errors gracefully
    const validProducts = products;

    console.log(`✅ Total products after processing: ${validProducts.length}`);

    // Group products by production groups
    const productionGroups = await ProductionGroup.find({ 
      company: filterCompanyId || userCompanyId,
      isActive: true 
    }).populate('items', 'name').lean();

    console.log(`🏭 Found ${productionGroups.length} production groups`);

    // Create a map of productId to production group for quick lookup
    const productGroupMap = {};
    productionGroups.forEach(group => {
      group.items.forEach(item => {
        productGroupMap[item._id.toString()] = {
          groupId: group._id,
          groupName: group.name,
          groupDescription: group.description
        };
      });
    });

    // Group products by their production groups
    const groupedProducts = {};
    const ungroupedProducts = [];

    validProducts.forEach(product => {
      const productIdStr = product.productId.toString();
      const groupInfo = productGroupMap[productIdStr];
      
      if (groupInfo) {
        const groupKey = groupInfo.groupId.toString();
        if (!groupedProducts[groupKey]) {
          groupedProducts[groupKey] = {
            groupId: groupInfo.groupId,
            groupName: groupInfo.groupName,
            groupDescription: groupInfo.groupDescription,
            products: []
          };
        }
        groupedProducts[groupKey].products.push(product);
      } else {
        // Products not assigned to any production group
        ungroupedProducts.push(product);
      }
    });

    // Convert to array format
    const productionGroupsData = Object.values(groupedProducts);
    
    console.log(`📊 Grouped into ${productionGroupsData.length} production groups`);
    console.log(`🔄 ${ungroupedProducts.length} products without production group`);

    res.json({
      success: true,
      date: summaryDate ? summaryDate.toISOString().split('T')[0] : 'all-dates',
      companyId: filterCompanyId,
      totalProducts: validProducts.length,
      productionGroups: productionGroupsData,
      ungroupedProducts: ungroupedProducts // Products not assigned to any group
    });

  } catch (error) {
    console.error('Error getting sales summary:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * POST /api/sales/update-summary
 * Update manual input fields and recalculate formulas
 */
export const updateSalesSummary = async (req, res) => {
  try {
    const { date, productId, updates } = req.body;
    const userRole = req.user.role;
    const userCompanyId = req.user.companyId;

    console.log('🔍 UPDATE SALES SUMMARY REQUEST:');
    console.log('  📅 Requested Date:', date);
    console.log('  🏢 User Company ID:', userCompanyId);
    console.log('  📦 Product ID:', productId);
    console.log('  📝 Updates:', updates);

    // Validation
    if (!date || !productId || !updates) {
      return res.status(400).json({
        success: false,
        message: 'Date, productId, and updates are required'
      });
    }

    // Date validation - PRESERVE THE ORIGINAL DATE from request
    const summaryDate = new Date(date);
    if (isNaN(summaryDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Use YYYY-MM-DD'
      });
    }
    summaryDate.setUTCHours(0, 0, 0, 0);
    
    console.log('  🎯 Parsed Summary Date (UTC):', summaryDate.toISOString());
    console.log('  📅 Summary Date (Local):', summaryDate.toISOString().split('T')[0]);

    // Validate updates object
    const allowedFields = ['packing', 'productionFinalBatches', 'physicalStock', 'batchAdjusted', 'qtyPerBatch', 'toBeProducedDay', 'produceBatches'];
    const updateFields = {};
    
    for (const [field, value] of Object.entries(updates)) {
      if (!allowedFields.includes(field)) {
        return res.status(400).json({
          success: false,
          message: `Field '${field}' is not allowed for updates`
        });
      }
      
      const numValue = parseFloat(value);
      if (isNaN(numValue) || numValue < 0) {
        return res.status(400).json({
          success: false,
          message: `Field '${field}' must be a non-negative number`
        });
      }
      
      updateFields[field] = numValue;
    }

    // Product validation
    const product = await Item.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Determine company ID for summary
    let summaryCompanyId;
    if (userRole === 'Unit Manager' || userRole === 'Unit Head') {
      if (!userCompanyId) {
        return res.status(403).json({
          success: false,
          message: 'User not assigned to any company'
        });
      }
      summaryCompanyId = userCompanyId;
    } else if (userRole === 'Super Admin') {
      // For super admin, use the company from existing summary or user's company
      summaryCompanyId = userCompanyId; // Default fallback
    } else {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions to update sales summary'
      });
    }

    // Find existing summary document - FIXED: Use only company + product, ignore date completely
    console.log('🔍 Searching for existing summary with:');
    console.log('  🏢 Company ID:', summaryCompanyId);
    console.log('  📦 Product ID:', productId);
    console.log('  ⚠️ IGNORING DATE - Using only company + product for lookup');
    
    let summary = await ProductDailySummary.findOne({
      companyId: summaryCompanyId,
      productId: new mongoose.Types.ObjectId(productId)
    });

    console.log('📋 Found existing summary:', summary ? 'YES' : 'NO');
    if (summary) {
      console.log('  📅 Existing summary date:', summary.date.toISOString());
      console.log('  📅 Existing summary date (local):', summary.date.toISOString().split('T')[0]);
    }

    if (!summary) {
      // Create new summary when explicitly updating through API (legitimate business operation)
      console.log(`✨ Creating new product summary for ${product.name} on ${summaryDate.toISOString().split('T')[0]} via API update`);
      
      summary = new ProductDailySummary({
        date: summaryDate, // IMPORTANT: Use the exact date from request, not current date
        companyId: summaryCompanyId,
        productId: new mongoose.Types.ObjectId(productId),
        productName: product.name,
        totalIndent: 0,
        status: 'pending', // Always set to pending for new summaries
        // Use values from frontend payload, with fallbacks for fields NOT being updated
        qtyPerBatch: updateFields.qtyPerBatch || 0,
        packing: updateFields.packing || 0,
        physicalStock: updateFields.physicalStock || 0,
        batchAdjusted: updateFields.batchAdjusted || 0,
        productionFinalBatches: updateFields.productionFinalBatches || 0,
        toBeProducedDay: updateFields.toBeProducedDay || 0,
        produceBatches: updateFields.produceBatches || 0
      });
      
      console.log('📅 New summary will have date:', summary.date.toISOString());
      console.log('📊 New summary with frontend values:', {
        produceBatches: summary.produceBatches,
        productionFinalBatches: summary.productionFinalBatches,
        toBeProducedDay: summary.toBeProducedDay
      });
    } else {
      // Update existing summary - PRESERVE the original date
      console.log('🔄 Updating existing summary, preserving original date:', summary.date.toISOString());
      Object.assign(summary, updateFields);
      
      // IMPORTANT: Reset status to pending when production data is updated
      summary.status = 'pending';
      console.log('🔄 Status reset to pending due to production data update');
      
      // DO NOT modify the date - keep original date
      console.log('📅 After update, summary date remains:', summary.date.toISOString());
    }

    // Only calculate formulas for fields NOT provided in updates
    // If frontend provides calculated values, preserve them
    if (!updateFields.hasOwnProperty('productionFinalBatches')) {
      summary.productionFinalBatches = Math.round((summary.batchAdjusted * summary.qtyPerBatch) * 100) / 100;
    }
    
    if (!updateFields.hasOwnProperty('produceBatches') && summary.qtyPerBatch > 0) {
      summary.produceBatches = Math.round((summary.toBeProducedDay / summary.qtyPerBatch) * 100) / 100;
      summary.toBeProducedBatches = summary.produceBatches;
    }
    
    if (!updateFields.hasOwnProperty('expiryShortage')) {
      summary.expiryShortage = Math.round((summary.productionFinalBatches - summary.toBeProducedDay) * 100) / 100;
    }
    
    console.log('💾 About to save summary with date:', summary.date.toISOString());
    console.log('📊 Summary fields before save:', {
      date: summary.date.toISOString(),
      productName: summary.productName,
      ...updateFields,
      finalValues: {
        produceBatches: summary.produceBatches,
        productionFinalBatches: summary.productionFinalBatches,
        toBeProducedDay: summary.toBeProducedDay
      }
    });
    
    await summary.save();
    
    console.log('✅ Summary saved successfully with date:', summary.date.toISOString());
    console.log('📅 Final saved date (local):', summary.date.toISOString().split('T')[0]);

    res.json({
      success: true,
      summary: {
        productId: summary.productId,
        productName: summary.productName,
        date: summary.date.toISOString().split('T')[0],
        status: summary.status, // Include status in response
        qtyPerBatch: summary.qtyPerBatch,
        packing: summary.packing,
        batchAdjusted: summary.batchAdjusted,
        physicalStock: summary.physicalStock,
        totalIndent: summary.totalIndent,
        productionFinalBatches: summary.productionFinalBatches,
        toBeProducedDay: summary.toBeProducedDay,
        toBeProducedBatches: summary.toBeProducedBatches,
        expiryShortage: summary.expiryShortage,
        produceBatches: summary.produceBatches,
      }
    });

  } catch (error) {
    console.error('Error updating sales summary:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};