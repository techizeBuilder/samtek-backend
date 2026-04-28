import ProductDailySummary from '../models/ProductDailySummary.js';
import ProductDetailsDailySummary from '../models/ProductDetailsDailySummary.js';
import ProductionBatch from '../models/ProductionBatch.js';
import { getSalesBreakdown } from '../services/productionSummaryService.js';
import { Item } from '../models/Inventory.js';
import ProductionGroup from '../models/ProductionGroup.js';
import mongoose from 'mongoose';

/**
 * GET /api/sales/product-summary
 * Get daily sales summary for all products (for Sales Approval Dashboard)
 * Now uses ProductDetailsDailySummary for daily data
 */
export const getSalesSummary = async (req, res) => {
  try {
    const { date, companyId, fromDate, toDate } = req.query;
    const userRole = req.user.role;
    const userCompanyId = req.user.companyId;

    // Date handling enabled for unit-manager indent-summary
    let dailyFilter = {};
    let summaryDate = null;
    
    if (fromDate && toDate) {
      const start = new Date(fromDate);
      const end = new Date(toDate);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        start.setUTCHours(0, 0, 0, 0);
        end.setUTCHours(23, 59, 59, 999);
        dailyFilter.date = { $gte: start, $lte: end };
        summaryDate = start; // Fallback for UI fields that expect a single date
        console.log(`📅 Range filtering: ${start.toISOString()} to ${end.toISOString()}`);
      }
    } else if (date) {
      summaryDate = new Date(date);
      if (!isNaN(summaryDate.getTime())) {
        summaryDate.setUTCHours(0, 0, 0, 0);
        dailyFilter.date = summaryDate;
        console.log(`📅 Single date filtering: ${summaryDate.toISOString().split('T')[0]}`);
      }
    }

    // Default to today if no date provided at all
    if (!summaryDate || Object.keys(dailyFilter).length === 0) {
      summaryDate = new Date();
      summaryDate.setUTCHours(0, 0, 0, 0);
      dailyFilter.date = summaryDate;
      console.log('📅 Default behavior: filtering for today');
    }

    
    // Company filtering based on user role
    let filterCompanyId;
    if (userRole === 'Unit Manager' || userRole === 'Unit Head') {
      if (!userCompanyId) {
        return res.status(403).json({
          success: false,
          message: 'User not assigned to any company'
        });
      }
      filterCompanyId = userCompanyId;
    } else if (userRole === 'Superadmin' && companyId) {
      filterCompanyId = companyId;
    } else if (userRole === 'Superadmin') {
      filterCompanyId = null;
    } else {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions to access sales summary'
      });
    }

    if (filterCompanyId) {
      dailyFilter.companyId = new mongoose.Types.ObjectId(filterCompanyId);
    }

    console.log('🏢 Filter company ID:', filterCompanyId);
    console.log('👤 User role:', userRole);

    // Step 1: Get master product data
    const masterFilter = {};
    if (filterCompanyId) {
      masterFilter.companyId = new mongoose.Types.ObjectId(filterCompanyId);
    }

    const masterProducts = await ProductDailySummary.find(masterFilter)
      .populate('productId', 'name category subCategory batch')
      .populate('companyId', 'name')
      .sort({ productName: 1 });

    // Step 2: Get daily details for the specific criteria
    let dailyDetails = await ProductDetailsDailySummary.find(dailyFilter)
      .populate('productId', 'name category subCategory')
      .populate('companyId', 'name');

    console.log('📊 Daily details found:', dailyDetails.length);

    // If no data for the specific date, show master products with empty sales data
    if (dailyDetails.length === 0) {
      console.log('⚠️ No daily data found for specific date, showing master products with empty sales...');
      
      // Create empty daily details for all master products
      const emptyDailyDetails = masterProducts.map(masterProduct => ({
        _id: `empty-${masterProduct._id}`,
        date: summaryDate,
        productId: masterProduct.productId,
        companyId: masterProduct.companyId,
        productionFinalBatches: 0,
        packing: 0,
        physicalStock: 0,
        batchAdjusted: 0,
        toBeProduced: 0
      }));
    }

    // Aggregated range check
    const isRange = fromDate && toDate && fromDate !== toDate;

    // Step 3: Create a map or list of daily details
    // If it's a range, we show all individual daily entries (History view)
    // If it's a single day, we show all master products (Approval view)
    
    let processedSummaries = [];

    if (isRange) {
      console.log('📅 RANGE MODE: Processing individual daily records for range...');
      processedSummaries = dailyDetails.map(detail => {
        // Get qtyPerBatch from Item.batch field or master summary
        const masterProduct = masterProducts.find(mp => 
          mp.productId?._id?.toString() === detail.productId?._id?.toString()
        );
        let qtyPerBatch = masterProduct?.qtyPerBatch || detail.qtyPerBatch || 0;
        
        return {
          _id: detail._id,
          dailyDetailsId: detail._id,
          productId: detail.productId,
          productName: detail.productId?.name || masterProduct?.productName || "Unknown",
          companyId: detail.companyId,
          date: detail.date,
          qtyPerBatch: qtyPerBatch,
          packing: detail.packing || 0,
          physicalStock: detail.physicalStock || 0,
          batchAdjusted: detail.batchAdjusted || 0,
          totalQuantity: detail.totalQuantity || 0,
          totalIndent: detail.totalIndent || 0,
          productionFinalBatches: detail.productionFinalBatches || 0,
          toBeProducedDay: detail.toBeProducedDay || 0,
          toBeProducedBatches: detail.toBeProducedBatches || 0,
          produceBatches: detail.produceBatches || 0,
          expiryShortage: detail.expiryShortage || 0,
          balanceFinalBatches: detail.balanceFinalBatches || 0,
          status: detail.status || 'pending',
          hasDailyData: true,
          updatedAt: detail.updatedAt
        };
      });
    } else {
      console.log('📅 SINGLE DATE MODE: Processing master products logic...');
      const dailyDetailsMap = new Map();
      dailyDetails.forEach(detail => {
        const pId = detail.productId?._id?.toString() || detail.productId?.toString();
        if (pId) dailyDetailsMap.set(pId, detail);
      });

      processedSummaries = masterProducts.map(masterProduct => {
        const productId = masterProduct.productId ? masterProduct.productId._id.toString() : null;
        const dailyDetail = dailyDetailsMap.get(productId);
        
        // Get qtyPerBatch from Item.batch field or fallback
        let qtyPerBatch = masterProduct.qtyPerBatch || 0;
        if (masterProduct.productId?.batch) {
          const batchValue = Number(masterProduct.productId.batch);
          if (!isNaN(batchValue) && batchValue > 0) qtyPerBatch = batchValue;
        }

        return {
          _id: masterProduct._id,
          productId: masterProduct.productId,
          productName: masterProduct.productName,
          companyId: masterProduct.companyId,
          date: summaryDate,
          qtyPerBatch: qtyPerBatch,
          packing: dailyDetail?.packing || 0,
          physicalStock: dailyDetail?.physicalStock || 0,
          batchAdjusted: dailyDetail?.batchAdjusted || 0,
          totalQuantity: dailyDetail?.totalQuantity || 0,
          totalIndent: dailyDetail?.totalIndent || 0,
          productionFinalBatches: dailyDetail?.productionFinalBatches || 0,
          toBeProducedDay: dailyDetail?.toBeProducedDay || 0,
          toBeProducedBatches: dailyDetail?.toBeProducedBatches || 0,
          produceBatches: dailyDetail?.produceBatches || 0,
          expiryShortage: dailyDetail?.expiryShortage || 0,
          balanceFinalBatches: dailyDetail?.balanceFinalBatches || 0,
          status: dailyDetail?.status || 'pending',
          hasDailyData: !!dailyDetail,
          dailyDetailsId: dailyDetail?._id || null,
          createdAt: masterProduct.createdAt,
          updatedAt: dailyDetail?.updatedAt || masterProduct.updatedAt
        };
      });
    }

    // Step 5: Get sales breakdown for orders
    const salesBreakdown = await getSalesBreakdown(
      masterProducts.map(s => s.productId),
      dailyFilter.date,
      filterCompanyId
    );

    // Step 6: Attach sales data (For range, we must match by product AND date)
    const productsWithSalesData = processedSummaries.map(product => {
      // Find matching salesperson data
      const salesData = salesBreakdown.find(s => 
        s.productId && product.productId &&
        s.productId.toString() === (product.productId._id?.toString() || product.productId.toString())
      );

      return {
        ...product,
        // Ensure totalQuantity and totalIndent are populated (from real-time breakdown if needed)
        totalQuantity: Number(product.totalQuantity) || Number(salesData?.summary?.totalIndent) || 0,
        totalIndent: Number(product.totalIndent) || Number(salesData?.summary?.totalIndent) || 0,
        salesBreakdown: salesData?.salesBreakdown || []
      };
    });


    // Step 7: Build the response with production groups
    const productGroups = await ProductionGroup.find({
      ...(filterCompanyId && { company: filterCompanyId }),
      isActive: true
    }).populate('items');

    const validProducts = productsWithSalesData.filter(p => 
      p.productId && (p.productId._id || p.productId) && p.productName
    );
    const productionGroupsData = productGroups.map(group => {
      const groupProducts = validProducts.filter(product => {
        const pidStr = product.productId._id?.toString() || product.productId.toString();
        return group.items.some(item => item._id.toString() === pidStr);
      });

      console.log(`📋 Group "${group.name}" has ${groupProducts.length} products`);

      return {
        groupId: group._id,
        groupName: group.name,
        groupDescription: group.description || "",
        products: groupProducts.map(product => ({
          _id: product._id,
          dailyDetailsId: product.dailyDetailsId,
          productId: product.productId,
          productName: product.productName,
          companyId: product.companyId,
          date: product.date,
          qtyPerBatch: product.qtyPerBatch,
          batchAdjusted: product.batchAdjusted,
          productionFinalBatches: product.productionFinalBatches,
          totalQuantity: product.totalQuantity,
          totalIndent: product.totalIndent,
          physicalStock: product.physicalStock,
          toBeProducedDay: product.toBeProducedDay,
          toBeProducedBatches: product.toBeProducedBatches,
          produceBatches: product.produceBatches,
          expiryShortage: product.expiryShortage,
          balanceFinalBatches: product.balanceFinalBatches,
          status: product.status,
          salesBreakdown: product.salesBreakdown || []
        }))
      };
    });

    // Ungrouped products
    const groupedProductIds = new Set();
    productGroups.forEach(group => {
      group.items.forEach(item => {
        groupedProductIds.add(item._id.toString());
      });
    });

    const ungroupedProducts = validProducts
      .filter(product => !groupedProductIds.has(product.productId._id.toString()))
      .map(product => ({
        _id: product._id,
        dailyDetailsId: product.dailyDetailsId,
        productId: product.productId,
        productName: product.productName,
        companyId: product.companyId,
        date: product.date,
        qtyPerBatch: product.qtyPerBatch,
        batchAdjusted: product.batchAdjusted,
        productionFinalBatches: product.productionFinalBatches,
        totalQuantity: product.totalQuantity,
        totalIndent: product.totalIndent,
        physicalStock: product.physicalStock,
        toBeProducedDay: product.toBeProducedDay,
        toBeProducedBatches: product.toBeProducedBatches,
        produceBatches: product.produceBatches,
        expiryShortage: product.expiryShortage,
        balanceFinalBatches: product.balanceFinalBatches,
        status: product.status,
        salesBreakdown: product.salesBreakdown || []
      }));

    console.log('✅ Response built successfully');
    console.log('🏭 Production groups with products:', productionGroupsData.length);
    console.log('📋 Ungrouped products:', ungroupedProducts.length);
    console.log('📊 Total products processed:', validProducts.length);

    // NEW GROUPED RESPONSE FORMAT
    const responseData = {
      success: true,
      date: date || "all-dates",
      companyId: filterCompanyId || "all-companies",
      totalProducts: validProducts.length,
      productionGroups: productionGroupsData,
      ungroupedProducts: ungroupedProducts
    };

    console.log('🔍 New response format keys:', Object.keys(responseData));

    res.json(responseData);

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
 * POST /api/sales/update-product-summary
 * Update daily product details in ProductDetailsDailySummary
 */
export const updateSalesSummary = async (req, res) => {
  try {
    const { date, productId, updates, orderIds } = req.body;
    const userRole = req.user.role;
    const userCompanyId = req.user.companyId;
    console.log("Logged in Role:", userRole);
    console.log('📝 Update request received:', { date, productId, updates, orderIds });

    // Validate required fields
    if (!date || !productId || !updates) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: date, productId, and updates are required'
      });
    }

    // Validate orderIds if provided (optional field)
    if (orderIds && Array.isArray(orderIds)) {
      const invalidIds = orderIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
      if (invalidIds.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid orderIds format'
        });
      }
    }

    // Parse and validate date
    const summaryDate = new Date(date);
    if (isNaN(summaryDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Use YYYY-MM-DD'
      });
    }
    summaryDate.setUTCHours(0, 0, 0, 0);

    // Extract productId - handle both string and object formats
    let actualProductId;
    if (typeof productId === 'string') {
      actualProductId = productId;
    } else if (typeof productId === 'object' && productId._id) {
      actualProductId = productId._id;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid productId format - must be string or object with _id'
      });
    }

    // Validate productId
    if (!mongoose.Types.ObjectId.isValid(actualProductId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid productId format'
      });
    }

    console.log('✅ Using productId:', actualProductId);

    // Get master product data to validate access and get qtyPerBatch
    const masterProduct = await ProductDailySummary.findOne({
      productId: new mongoose.Types.ObjectId(actualProductId)
    }).populate('productId companyId');

    if (!masterProduct) {
      return res.status(404).json({
        success: false,
        message: 'Product not found in master data'
      });
    }

    // Check permissions
   if (userRole !== 'Unit Manager' && userRole !== 'Unit Head') {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions to update this product'
      });
    }

    console.log('✅ Master product found:', masterProduct.productName);
    console.log('📅 Updating daily details for date:', summaryDate.toISOString().split('T')[0]);

    // Find or create daily details record
    let dailyDetails = await ProductDetailsDailySummary.findOne({
      date: summaryDate,
      productId: new mongoose.Types.ObjectId(actualProductId),
      companyId: userCompanyId // FIX: always use user's companyId for lookup
    });

    if (!dailyDetails) {
      // Create new daily details record
      dailyDetails = new ProductDetailsDailySummary({
        date: summaryDate,
        productId: new mongoose.Types.ObjectId(actualProductId),
        productDailySummaryId: masterProduct._id,
        companyId: userCompanyId, // FIX: always use user's companyId for creation
        orderIds: orderIds ? orderIds.map(id => new mongoose.Types.ObjectId(id)) : []
      });
      console.log('📝 Creating new daily details record with orderIds:', orderIds);
    } else {
      // Update orderIds if provided
      if (orderIds && Array.isArray(orderIds)) {
        dailyDetails.orderIds = orderIds.map(id => new mongoose.Types.ObjectId(id));
        console.log('📝 Updating existing daily details record with orderIds:', orderIds);
      } else {
        console.log('📝 Updating existing daily details record');
      }
    }
    // 🔍 Capture the old status and batchAdjusted BEFORE applying updates (needed for batch logic)
    const oldStatus = dailyDetails.status;
    const oldBatchAdjusted = dailyDetails.batchAdjusted || 0;
    console.log('📌 Previous status:', oldStatus, '→ New status:', updates.status || oldStatus);
    console.log('📌 Previous batchAdjusted:', oldBatchAdjusted, '→ New batchAdjusted:', updates.batchAdjusted ?? oldBatchAdjusted);

    // Apply updates to daily details
    Object.keys(updates).forEach(key => {
      if (dailyDetails.schema.paths[key] && key !== '_id' && key !== '__v') {
        dailyDetails[key] = updates[key];
        console.log(`  ✏️ Updated ${key}: ${updates[key]}`);
      }
    });

    // Validate approval requirements
    if (updates.status === 'approved') {
      // Check if batchAdjusted is set and > 0
      const batchAdjusted = dailyDetails.batchAdjusted;
      if (!batchAdjusted || batchAdjusted <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Batch Adjusted must be greater than 0 to approve the product',
          field: 'batchAdjusted',
          currentValue: batchAdjusted || 0
        });
      }
    }

    // Don't recalculate if frontend already provided the values
    // Frontend has already calculated productionFinalBatches, produceBatches, etc.
    // Only calculate if missing values
    if (!updates.productionFinalBatches || !updates.produceBatches) {
      console.log('🔢 Calculating missing formulas with qtyPerBatch:', masterProduct.qtyPerBatch);
      dailyDetails.calculateFormulas(masterProduct.qtyPerBatch);
    } else {
      console.log('✅ Using frontend-calculated values:', {
        productionFinalBatches: updates.productionFinalBatches,
        produceBatches: updates.produceBatches
      });
    }

    // Save the daily details
    await dailyDetails.save();

    console.log('💾 Daily details saved successfully');
    
    // 🎯 Handle ProductionBatch creation/removal based on status changes
    if (userRole === 'Unit Manager') {
      // CASE 1: Status changed to approved (first time approval)
      if (updates.status === 'approved' && oldStatus !== 'approved') {
        console.log('🏭 Unit Manager approved product - creating ProductionBatch entries...');
        console.log(`   Status transition: ${oldStatus} → approved`);
        
        const today = new Date(summaryDate);
        today.setUTCHours(0, 0, 0, 0);
        
        // Validate before creating batches
        if (dailyDetails.batchAdjusted > 0) {
          console.log(`📊 Approving product with batchAdjusted: ${dailyDetails.batchAdjusted}`);
          
          // Check if product is in a production group
          const productionGroup = await ProductionGroup.findOne({
            company: masterProduct.companyId._id,
            items: new mongoose.Types.ObjectId(actualProductId),
            isActive: true
          });
          
          if (productionGroup) {
            console.log(`   Product belongs to group: ${productionGroup.groupName}`);
            
            // Get existing batches for this group (exclude completed ones)
            const existingBatchDocs = await ProductionBatch.find({
              groupId: productionGroup._id,
              companyId: masterProduct.companyId._id,
              productionDate: today,
              status: { $ne: 'completed' }
            }).sort({ batchNumber: 1 });
            
            console.log(`   📊 EXISTING batches: ${existingBatchDocs.length}`);
            existingBatchDocs.forEach(b => {
              console.log(`      ${b.batchNo}: totalBatchAdjusted=${b.totalBatchAdjusted}`);
            });
            
            // IMPORTANT: Keep ONLY full batches (1.0), DELETE fractional batches (old remainders)
            const fullBatches = existingBatchDocs.filter(b => b.totalBatchAdjusted === 1.0);
            const fractionalBatches = existingBatchDocs.filter(b => b.totalBatchAdjusted < 1.0);
            
            console.log(`   ✅ Full batches (1.0) to KEEP: ${fullBatches.length}`);
            fullBatches.forEach(b => console.log(`      ${b.batchNo}`));
            
            if (fractionalBatches.length > 0) {
              console.log(`   🗑️ Fractional batches (old remainders) to DELETE: ${fractionalBatches.length}`);
              fractionalBatches.forEach(b => console.log(`      ${b.batchNo} (${b.totalBatchAdjusted})`));
              
              const fractionalIds = fractionalBatches.map(b => b._id);
              const deleteResult = await ProductionBatch.deleteMany({
                _id: { $in: fractionalIds }
              });
              console.log(`   ✅ DELETED ${deleteResult.deletedCount} old fractional batches`);
            }
            
            // Get all approved products in this group
            const groupProductIds = productionGroup.items;
            const groupDailyDetails = await ProductDetailsDailySummary.find({
              date: today,
              productId: { $in: groupProductIds },
              companyId: masterProduct.companyId._id,
              status: 'approved'
            });
            
            // Calculate group total from ALL approved products
            const groupTotal = groupDailyDetails.reduce((sum, detail) => sum + (detail.batchAdjusted || 0), 0);
            console.log(`   📊 ALL approved products total: ${groupTotal}`);
            
            // Calculate required batches
            const requiredBatches = Math.ceil(groupTotal);
            console.log(`   Required batches: ${requiredBatches}`);
            
            // Calculate batches to create (only count full batches as existing)
            const existingBatches = fullBatches.length;
            const batchesToCreate = Math.max(0, requiredBatches - existingBatches);
            console.log(`   Batches to create: ${batchesToCreate}`);
            
            if (batchesToCreate > 0) {
              // Get next batch number
              const allExistingBatches = await ProductionBatch.find({
                companyId: masterProduct.companyId._id,
                productionDate: today
              }).sort({ batchNumber: -1 }).limit(1);
              
              let nextBatchNumber = 1;
              if (allExistingBatches.length > 0) {
                nextBatchNumber = allExistingBatches[0].batchNumber + 1;
              }
              console.log(`   Starting batch number: ${nextBatchNumber}`);
              
              // ✅ FIX: Update qtyPerBatch from Item.batch if missing
              console.log(`   🔍 Checking qtyPerBatch for ${groupDailyDetails.length} products...`);
              for (const detail of groupDailyDetails) {
                console.log(`      Product ${detail.productId}: current qtyPerBatch = ${detail.qtyPerBatch}`);
                if (!detail.qtyPerBatch || detail.qtyPerBatch === 0) {
                  const item = await Item.findById(detail.productId).select('batch qty name').lean();
                  console.log(`      Item data:`, { name: item?.name, batch: item?.batch, qty: item?.qty });
                  if (item?.batch) {
                    const qtyFromBatch = parseFloat(item.batch) || 0;
                    console.log(`      Parsed batch: "${item.batch}" → ${qtyFromBatch}`);
                    if (qtyFromBatch > 0) {
                      detail.qtyPerBatch = qtyFromBatch;
                      // Update in database too
                      await ProductDetailsDailySummary.updateOne(
                        { _id: detail._id },
                        { $set: { qtyPerBatch: qtyFromBatch } }
                      );
                      console.log(`      ✅ Updated qtyPerBatch for ${detail.productId}: ${qtyFromBatch}`);
                    } else {
                      console.log(`      ⚠️ Batch value is 0 or invalid`);
                    }
                  } else {
                    console.log(`      ⚠️ Item has no batch field`);
                  }
                }
              }
              
              // Get all approved products in the group with their details (use ALL approved)
              const combinedItems = groupDailyDetails.map(detail => ({
                itemId: detail.productId,
                DailyProductionId: detail._id,
                batchAdjustedValue: detail.batchAdjusted || 0,
                qtyContribution: detail.qtyPerBatch || 0
              }));
              
              // Create new batches with ALL group items
              for (let i = 0; i < batchesToCreate; i++) {
                const currentBatchNumber = nextBatchNumber + i;
                const batchNo = `BATNO${String(currentBatchNumber).padStart(2, '0')}`;
                
                // Calculate dynamic totalBatchAdjusted for this batch
                const isLastBatch = (i === batchesToCreate - 1);
                const remainder = parseFloat((groupTotal - Math.floor(groupTotal)).toFixed(2));
                const batchAdjusted = isLastBatch && remainder > 0 ? remainder : 1.0;
                
                // Use first product's qtyPerBatch - get from Item.batch if 0
                let qtyPerBatch = groupDailyDetails[0]?.qtyPerBatch || 0;
                console.log(`   🔍 BATCH ${batchNo}: Initial qtyPerBatch from groupDailyDetails = ${qtyPerBatch}`);
                
                if (qtyPerBatch === 0) {
                  console.log(`   ⚠️ qtyPerBatch is 0! Fetching from Item.batch...`);
                  const item = await Item.findById(groupDailyDetails[0].productId).select('batch name').lean();
                  console.log(`   📦 Item found:`, item?.name, `batch field =`, item?.batch, `type =`, typeof item?.batch);
                  
                  if (item?.batch) {
                    qtyPerBatch = parseFloat(item.batch) || 0;
                    console.log(`   ✅ Parsed qtyPerBatch = ${qtyPerBatch}`);
                  } else {
                    console.log(`   ❌ ERROR: Item has no batch field!`);
                  }
                }
                
                console.log(`   🎯 FINAL qtyPerBatch for ${batchNo} = ${qtyPerBatch}`);
                const qtyAchieved = parseFloat((qtyPerBatch * batchAdjusted).toFixed(2));
                console.log(`   📊 qtyAchieved = ${qtyPerBatch} × ${batchAdjusted} = ${qtyAchieved}`);
                
                // 🔒 Check if batch already exists to avoid duplicate key error
                const existingBatch = await ProductionBatch.findOne({
                  companyId: masterProduct.companyId._id,
                  batchNo: batchNo,
                  productionDate: today
                });
                
                if (existingBatch) {
                  console.log(`   ⚠️ Batch ${batchNo} already exists, updating instead of creating...`);
                  existingBatch.qtyPerBatch = qtyPerBatch;
                  existingBatch.qtyAchieved = qtyAchieved;
                  existingBatch.totalBatchAdjusted = batchAdjusted;
                  existingBatch.combinedItems = combinedItems;
                  existingBatch.groupId = productionGroup._id;
                  existingBatch.status = existingBatch.status === 'completed' ? 'completed' : 'pending';
                  await existingBatch.save();
                  console.log(`   ✅ Updated existing batch ${batchNo}`);
                } else {
                  const newBatch = new ProductionBatch({
                    itemId: groupProductIds[0],
                    groupId: productionGroup._id,
                    companyId: masterProduct.companyId._id,
                    productionDate: today,
                    batchNumber: currentBatchNumber,
                    batchNo: batchNo,
                    qtyPerBatch: qtyPerBatch,
                    qtyAchieved: qtyAchieved,
                    totalBatchAdjusted: batchAdjusted,
                    status: 'pending',
                    combinedItems: combinedItems,
                    approvedBy: req.user.username,
                    createdAt: new Date()
                  });
                  
                  await newBatch.save();
                  console.log(`   ✅ Created batch ${batchNo}`);
                }
              }
              
              console.log(`   ✅ Created ${batchesToCreate} new batches for group`);
            } else {
              console.log(`   ✅ No additional batches needed (existing batches sufficient)`);
              
              // Still need to update full batches with newly approved product!
              if (fullBatches.length > 0) {
                console.log(`   🔄 Updating ${fullBatches.length} full batches with ALL approved products...`);
                
                // Get qtyPerBatch from first product (now guaranteed to be set)
                const qtyPerBatch = groupDailyDetails[0]?.qtyPerBatch || 0;
                console.log(`   Using qtyPerBatch: ${qtyPerBatch}`);
                
                // Get updated combinedItems with ALL approved products
                const updatedCombinedItems = groupDailyDetails.map(detail => ({
                  itemId: detail.productId,
                  DailyProductionId: detail._id,
                  batchAdjustedValue: detail.batchAdjusted || 0,
                  qtyContribution: detail.qtyPerBatch || 0
                }));
                
                // Update all full batches with corrected qtyPerBatch and qtyAchieved
                for (const batch of fullBatches) {
                  batch.combinedItems = updatedCombinedItems;
                  batch.qtyPerBatch = qtyPerBatch;
                  batch.qtyAchieved = parseFloat((qtyPerBatch * batch.totalBatchAdjusted).toFixed(2));
                  await batch.save();
                  console.log(`      ✅ Updated ${batch.batchNo}: qtyPerBatch=${qtyPerBatch}, qtyAchieved=${batch.qtyAchieved}`);
                }
              }
            }
          } else {
            // Product not in a group - use individual batch creation
            console.log(`   Product is not in a production group - creating individual batches`);
            await createProductionBatchEntries({
              productId: actualProductId,
              companyId: masterProduct.companyId._id,
              date: summaryDate,
              qtyPerBatch: masterProduct.qtyPerBatch,
              batchAdjusted: dailyDetails.batchAdjusted,
              approvedBy: req.user.username,
              dailyDetailsId: dailyDetails._id
            });
          }
        } else {
          console.log(`⚠️ Skipped batch creation - invalid batchAdjusted value: ${dailyDetails.batchAdjusted}`);
        }
      } 
      // CASE 2: Already approved, but batchAdjusted changed - adjust batches
      // IMPORTANT: Only run this when status remains approved (or unchanged).
      // If frontend sends status "pending" together with a batchAdjusted change,
      // we must NOT stay in the approved-flow; the pending case below should run
      // so that ProductionBatch entries are removed.
      else if (
        oldStatus === 'approved' &&
        (updates.status === undefined || updates.status === 'approved') &&
        updates.batchAdjusted !== undefined &&
        updates.batchAdjusted !== oldBatchAdjusted
      ) {
        console.log('🔄 Unit Manager updated batchAdjusted on approved product - adjusting batches...');
        console.log(`   batchAdjusted changed: ${oldBatchAdjusted} → ${updates.batchAdjusted}`);
        
        const today = new Date(summaryDate);
        today.setUTCHours(0, 0, 0, 0);
        
        // Check if product is in a production group
        const productionGroup = await ProductionGroup.findOne({
          company: masterProduct.companyId._id,
          items: new mongoose.Types.ObjectId(actualProductId),
          isActive: true
        });
        
        if (productionGroup) {
          console.log(`   Product belongs to group: ${productionGroup.groupName}`);
          
          // Get all products in this group and their current batchAdjusted values
          const groupProductIds = productionGroup.items;
          const groupDailyDetails = await ProductDetailsDailySummary.find({
            date: today,
            productId: { $in: groupProductIds },
            companyId: masterProduct.companyId._id,
            status: 'approved'
          });
          
          // Calculate new group total
          let groupTotal = 0;
          let oldTotal = 0;
          console.log(`   📊 GROUP CALCULATION:`);
          for (const detail of groupDailyDetails) {
            const productIdStr = detail.productId.toString();
            const isUpdatedProduct = productIdStr === actualProductId.toString();
            const oldValue = detail.batchAdjusted || 0;
            const newValue = isUpdatedProduct ? updates.batchAdjusted : oldValue;
            
            oldTotal += oldValue;
            groupTotal += newValue;
            
            console.log(`      Product ${productIdStr.substring(0, 8)}: ${oldValue} → ${newValue} ${isUpdatedProduct ? '(UPDATED)' : ''}`);
          }
          
          console.log(`   📊 OLD Total: ${oldTotal}`);
          console.log(`   📊 NEW Total: ${groupTotal}`);
          console.log(`   📊 Difference: ${oldTotal} - ${updates.batchAdjusted} + ${updates.batchAdjusted} = ${groupTotal}`);
          
          // NEW LOGIC: Keep full batches unchanged, delete rest, create new for remainder
          // Calculate how many FULL batches (1.0) we need
          const fullBatches = Math.floor(groupTotal);
          const remainder = parseFloat((groupTotal - fullBatches).toFixed(2));
          
          console.log(`   🎯 BATCH CALCULATION:`);
          console.log(`      Full batches to KEEP: ${fullBatches}`);
          console.log(`      Remainder for NEW batch: ${remainder}`);
          
          // Count existing batches for this group
          const existingBatches = await ProductionBatch.countDocuments({
            groupId: productionGroup._id,
            companyId: masterProduct.companyId._id,
            productionDate: today,
            status: { $ne: 'completed' }
          });
          console.log(`      Existing batches in DB: ${existingBatches}`);
          
          // Get all existing batches sorted by batch number
          let existingBatchDocs = await ProductionBatch.find({
            groupId: productionGroup._id,
            companyId: masterProduct.companyId._id,
            productionDate: today,
            status: { $ne: 'completed' }
          }).sort({ batchNumber: 1 });
          
          console.log(`   📋 EXISTING BATCHES BEFORE DELETE:`);
          existingBatchDocs.forEach(b => {
            console.log(`      ${b.batchNo} (batchNumber: ${b.batchNumber}): totalBatchAdjusted=${b.totalBatchAdjusted}`);
          });
          
          // Step 1: KEEP first 'fullBatches' batches UNCHANGED (don't touch their combinedItems!)
          console.log(`   ✅ KEEPING first ${fullBatches} batches UNCHANGED (BATNO01-BATNO${String(fullBatches).padStart(2, '0')})`);
          
          // Step 2: DELETE all batches AFTER position 'fullBatches'
          if (existingBatches > fullBatches) {
            const batchesToDelete = existingBatches - fullBatches;
            console.log(`   🗑️ DELETING ${batchesToDelete} batches after position ${fullBatches}...`);
            
            // Get batches to delete (all after fullBatches position)
            const batchesToRemove = existingBatchDocs.slice(fullBatches); // All batches after fullBatches
            const batchIds = batchesToRemove.map(b => b._id);
            
            console.log(`   🗑️ Batches to DELETE:`);
            batchesToRemove.forEach(b => {
              console.log(`      ${b.batchNo} (batchNumber: ${b.batchNumber}, _id: ${b._id})`);
            });
            
            if (batchIds.length > 0) {
              const deleteResult = await ProductionBatch.deleteMany({
                _id: { $in: batchIds }
              });
              console.log(`   ✅ DELETED ${deleteResult.deletedCount} batches (kept first ${fullBatches} unchanged)`);
            }
          }
          
          // Step 3: CREATE NEW batch for remainder (if any) with UPDATED combinedItems
          if (remainder > 0) {
            console.log(`   ➕ Creating 1 new batch for remainder ${remainder}...`);
            
            // ✅ FIX: Update qtyPerBatch from Item.batch if missing
            for (const detail of groupDailyDetails) {
              if (!detail.qtyPerBatch || detail.qtyPerBatch === 0) {
                const item = await Item.findById(detail.productId).select('batch').lean();
                if (item?.batch) {
                  const qtyFromBatch = parseFloat(item.batch) || 0;
                  if (qtyFromBatch > 0) {
                    detail.qtyPerBatch = qtyFromBatch;
                    await ProductDetailsDailySummary.updateOne(
                      { _id: detail._id },
                      { $set: { qtyPerBatch: qtyFromBatch } }
                    );
                    console.log(`   ✅ Updated qtyPerBatch for ${detail.productId}: ${qtyFromBatch}`);
                  }
                }
              }
            }
            
            // Simple: new batch number = fullBatches + 1
            // Example: fullBatches=2, newBatch=3 (BATNO03)
            const nextBatchNumber = fullBatches + 1;
            const batchNo = `BATNO${String(nextBatchNumber).padStart(2, '0')}`;
            console.log(`   Creating batch ${batchNo} (position ${nextBatchNumber}) with remainder ${remainder}`);
            
            // Get all approved products in the group with UPDATED values
            const combinedItems = groupDailyDetails.map(detail => ({
              itemId: detail.productId,
              DailyProductionId: detail._id,
              batchAdjustedValue: detail.productId.toString() === actualProductId.toString() 
                ? updates.batchAdjusted  // NEW updated value
                : (detail.batchAdjusted || 0),
              qtyContribution: detail.qtyPerBatch || 0
            }));
            
            // Use first product's qtyPerBatch (now guaranteed to be correct)
            const qtyPerBatch = groupDailyDetails[0]?.qtyPerBatch || 0;
            const qtyAchieved = parseFloat((qtyPerBatch * remainder).toFixed(2));
            
            // 🔒 Check if batch already exists to avoid duplicate key error
            const existingBatch = await ProductionBatch.findOne({
              companyId: masterProduct.companyId._id,
              batchNo: batchNo,
              productionDate: today
            });
            
            if (existingBatch) {
              console.log(`   ⚠️ Batch ${batchNo} already exists, updating instead of creating...`);
              existingBatch.qtyPerBatch = qtyPerBatch;
              existingBatch.qtyAchieved = qtyAchieved;
              existingBatch.totalBatchAdjusted = remainder;
              existingBatch.combinedItems = combinedItems;
              existingBatch.groupId = productionGroup._id;
              existingBatch.status = existingBatch.status === 'completed' ? 'completed' : 'pending';
              await existingBatch.save();
              console.log(`   ✅ Updated existing batch ${batchNo} with totalBatchAdjusted=${remainder}, qtyAchieved=${qtyAchieved}`);
            } else {
              const newBatch = new ProductionBatch({
                itemId: groupProductIds[0],
                groupId: productionGroup._id,
                companyId: masterProduct.companyId._id,
                productionDate: today,
                batchNumber: nextBatchNumber,
                batchNo: batchNo,
                qtyPerBatch: qtyPerBatch,
                qtyAchieved: qtyAchieved,
                totalBatchAdjusted: remainder,
                status: 'pending',
                combinedItems: combinedItems,
                approvedBy: req.user.username,
                createdAt: new Date()
              });
              
              await newBatch.save();
              console.log(`   ✅ Created batch ${batchNo} with totalBatchAdjusted=${remainder}, qtyAchieved=${qtyAchieved}`);
            }
          } else {
            console.log(`   ℹ️ No remainder - only ${fullBatches} full batches needed`);
          }
        } else {
          // Product not in a group - handle individually (same incremental logic)
          console.log(`   Product is not in a production group - handling individually`);
          
          // Calculate required batches for this single product
          const requiredBatches = Math.ceil(updates.batchAdjusted);
          console.log(`   Required batches: ${requiredBatches}`);
          
          // Count existing batches for this product
          const existingBatches = await ProductionBatch.countDocuments({
            "combinedItems.itemId": actualProductId,
            companyId: masterProduct.companyId._id,
            productionDate: today,
            status: { $ne: 'completed' }
          });
          console.log(`   Existing batches: ${existingBatches}`);
          
          // Adjust batches (delete or create)
          if (requiredBatches < existingBatches) {
            // DELETE excess batches
            const batchesToDelete = existingBatches - requiredBatches;
            console.log(`   🗑️ Deleting ${batchesToDelete} excess batches...`);
            
            const batchesToRemove = await ProductionBatch.find({
              "combinedItems.itemId": actualProductId,
              companyId: masterProduct.companyId._id,
              productionDate: today,
              status: { $ne: 'completed' }
            }).sort({ createdAt: 1 }).limit(batchesToDelete);
            
            const batchIds = batchesToRemove.map(b => b._id);
            const deleteResult = await ProductionBatch.deleteMany({
              _id: { $in: batchIds }
            });
            
            console.log(`   ✅ Deleted ${deleteResult.deletedCount} excess batches`);
          } else if (requiredBatches > existingBatches) {
            // CREATE additional batches
            const batchesToCreate = requiredBatches - existingBatches;
            console.log(`   ➕ Creating ${batchesToCreate} additional batches...`);
            
            await createProductionBatchEntries({
              productId: actualProductId,
              companyId: masterProduct.companyId._id,
              date: summaryDate,
              qtyPerBatch: masterProduct.qtyPerBatch,
              batchAdjusted: updates.batchAdjusted,
              approvedBy: req.user.username,
              dailyDetailsId: dailyDetails._id
            });
          } else {
            console.log(`   ✅ Batch count unchanged (${existingBatches} batches sufficient)`);
          }
        }
      }
      // CASE 3: Status changed to pending
      else if (updates.status === 'pending') {
        console.log('⚠️ Unit Manager moved product back to pending - removing all ProductionBatch records...');
        
        const today = new Date(summaryDate);
        today.setUTCHours(0, 0, 0, 0);
        
        console.log(`🔍 Searching for ProductionBatch records for productId: ${actualProductId}`);
        console.log(`   Date: ${today.toISOString()}`);
        console.log(`   Company: ${masterProduct.companyId._id}`);
        
        // 🎯 AGGRESSIVE DELETE: Remove ALL ProductionBatch records for this product on this date
        // Method 1: Delete by combinedItems.itemId (for grouped products)
        const deletedByItemInArray = await ProductionBatch.deleteMany({
          "combinedItems.itemId": actualProductId,
          companyId: masterProduct.companyId._id,
          productionDate: today
        });
        
        console.log(`   Method 1 (combinedItems): Deleted ${deletedByItemInArray.deletedCount} records`);
        
        // Method 2: Delete by standalone itemId
        const deletedByDirectId = await ProductionBatch.deleteMany({
          itemId: actualProductId,
          companyId: masterProduct.companyId._id,
          productionDate: today
        });
        
        console.log(`   Method 2 (direct itemId): Deleted ${deletedByDirectId.deletedCount} records`);
        
        // Method 3: Delete by looking up through productDetailsDailySummary
        const dailyDetailsForDate = await ProductDetailsDailySummary.findOne({
          productId: actualProductId,
          date: today,
          companyId: masterProduct.companyId._id
        });
        
        if (dailyDetailsForDate) {
          const deletedByDailyId = await ProductionBatch.deleteMany({
            "combinedItems.DailyProductionId": dailyDetailsForDate._id,
            companyId: masterProduct.companyId._id,
            productionDate: today
          });
          console.log(`   Method 3 (by DailyProductionId): Deleted ${deletedByDailyId.deletedCount} records`);
        }
        
        // Method 4: Final safety net - delete any batch containing this product in combinedItems
        const allBatchesWithProduct = await ProductionBatch.find({
          "combinedItems.itemId": actualProductId,
          companyId: masterProduct.companyId._id,
          productionDate: today
        });
        
        if (allBatchesWithProduct.length > 0) {
          console.log(`   ⚠️ Safety net: Found ${allBatchesWithProduct.length} remaining batches containing this product`);
          for (const batch of allBatchesWithProduct) {
            console.log(`      Deleting batch: ${batch.batchNo}`);
            await ProductionBatch.deleteOne({ _id: batch._id });
          }
        }
        
        const totalDeleted = deletedByItemInArray.deletedCount + deletedByDirectId.deletedCount;
        console.log(`✅ Total ProductionBatch records deleted: ${totalDeleted}`);
        
        // Check if product is in a group for additional cleanup
        const productionGroup = await ProductionGroup.findOne({
          company: masterProduct.companyId._id,
          items: new mongoose.Types.ObjectId(actualProductId),
          isActive: true
        });
        
        if (productionGroup) {
          console.log(`   Product belongs to group: ${productionGroup.groupName}`);
          
          // Get remaining approved products in this group (excluding this one being set to pending)
          const groupProductIds = productionGroup.items;
          const groupDailyDetails = await ProductDetailsDailySummary.find({
            date: today,
            productId: { $in: groupProductIds, $ne: new mongoose.Types.ObjectId(actualProductId) },
            companyId: masterProduct.companyId._id,
            status: 'approved'
          });
          
          // Calculate new group total (without this product - so batchAdjusted = 0 for this product)
          let groupTotal = 0;
          let oldTotal = 0;
          console.log(`   📊 GROUP CALCULATION (moving to pending):`);
          for (const detail of groupDailyDetails) {
            groupTotal += (detail.batchAdjusted || 0);
            console.log(`      Product ${detail.productId.toString().substring(0, 8)}: ${detail.batchAdjusted || 0}`);
          }
          console.log(`      Product ${actualProductId.toString().substring(0, 8)}: 0 (MOVING TO PENDING)`);
          
          console.log(`   📊 NEW Total without this product: ${groupTotal}`);
          
          if (groupTotal > 0) {
            // USE SAME LOGIC AS CASE 2: Keep full batches, delete rest, create new for remainder
            const fullBatches = Math.floor(groupTotal);
            const remainder = parseFloat((groupTotal - fullBatches).toFixed(2));
            
            console.log(`   🎯 BATCH CALCULATION:`);
            console.log(`      Full batches to KEEP: ${fullBatches}`);
            console.log(`      Remainder for NEW batch: ${remainder}`);
            
            // Count existing batches
            const existingBatches = await ProductionBatch.countDocuments({
              groupId: productionGroup._id,
              companyId: masterProduct.companyId._id,
              productionDate: today,
              status: { $ne: 'completed' }
            });
            console.log(`      Existing batches in DB: ${existingBatches}`);
            
            // Get all existing batches
            let existingBatchDocs = await ProductionBatch.find({
              groupId: productionGroup._id,
              companyId: masterProduct.companyId._id,
              productionDate: today,
              status: { $ne: 'completed' }
            }).sort({ batchNumber: 1 });
            
            console.log(`   📋 EXISTING BATCHES BEFORE DELETE:`);
            existingBatchDocs.forEach(b => {
              console.log(`      ${b.batchNo} (batchNumber: ${b.batchNumber}): totalBatchAdjusted=${b.totalBatchAdjusted}`);
            });
            
            // Step 1: KEEP first 'fullBatches' batches UNCHANGED
            console.log(`   ✅ KEEPING first ${fullBatches} batches UNCHANGED`);
            
            // Step 2: DELETE all batches AFTER position 'fullBatches'
            if (existingBatches > fullBatches) {
              const batchesToDelete = existingBatches - fullBatches;
              console.log(`   🗑️ DELETING ${batchesToDelete} batches after position ${fullBatches}...`);
              
              const batchesToRemove = existingBatchDocs.slice(fullBatches);
              const batchIds = batchesToRemove.map(b => b._id);
              
              console.log(`   🗑️ Batches to DELETE:`);
              batchesToRemove.forEach(b => {
                console.log(`      ${b.batchNo} (batchNumber: ${b.batchNumber})`);
              });
              
              if (batchIds.length > 0) {
                const deleteResult = await ProductionBatch.deleteMany({
                  _id: { $in: batchIds }
                });
                console.log(`   ✅ DELETED ${deleteResult.deletedCount} batches`);
              }
            }
            
            // Step 3: CREATE NEW batch for remainder (if any) WITHOUT the pending product
            if (remainder > 0) {
              console.log(`   ➕ Creating 1 new batch for remainder ${remainder}...`);
              
              // ✅ FIX: Update qtyPerBatch from Item.batch if missing
              for (const detail of groupDailyDetails) {
                if (!detail.qtyPerBatch || detail.qtyPerBatch === 0) {
                  const item = await Item.findById(detail.productId).select('batch').lean();
                  if (item?.batch) {
                    const qtyFromBatch = parseFloat(item.batch) || 0;
                    if (qtyFromBatch > 0) {
                      detail.qtyPerBatch = qtyFromBatch;
                      await ProductDetailsDailySummary.updateOne(
                        { _id: detail._id },
                        { $set: { qtyPerBatch: qtyFromBatch } }
                      );
                      console.log(`   ✅ Updated qtyPerBatch for ${detail.productId}: ${qtyFromBatch}`);
                    }
                  }
                }
              }
              
              const nextBatchNumber = fullBatches + 1;
              const batchNo = `BATNO${String(nextBatchNumber).padStart(2, '0')}`;
              console.log(`   Creating batch ${batchNo} without pending product`);
              
              // combinedItems WITHOUT the pending product
              const combinedItems = groupDailyDetails.map(detail => ({
                itemId: detail.productId,
                DailyProductionId: detail._id,
                batchAdjustedValue: detail.batchAdjusted || 0,
                qtyContribution: detail.qtyPerBatch || 0
              }));
              
              const qtyPerBatch = groupDailyDetails[0]?.qtyPerBatch || 0;
              const qtyAchieved = parseFloat((qtyPerBatch * remainder).toFixed(2));
              
              // 🔒 Check if batch already exists to avoid duplicate key error
              const existingBatch = await ProductionBatch.findOne({
                companyId: masterProduct.companyId._id,
                batchNo: batchNo,
                productionDate: today
              });
              
              if (existingBatch) {
                console.log(`   ⚠️ Batch ${batchNo} already exists, updating instead of creating...`);
                existingBatch.qtyPerBatch = qtyPerBatch;
                existingBatch.qtyAchieved = qtyAchieved;
                existingBatch.totalBatchAdjusted = remainder;
                existingBatch.combinedItems = combinedItems;
                existingBatch.groupId = productionGroup._id;
                existingBatch.status = existingBatch.status === 'completed' ? 'completed' : 'pending';
                await existingBatch.save();
                console.log(`   ✅ Updated existing batch ${batchNo} with remainder ${remainder}`);
              } else {
                const newBatch = new ProductionBatch({
                  itemId: groupProductIds[0],
                  groupId: productionGroup._id,
                  companyId: masterProduct.companyId._id,
                  productionDate: today,
                  batchNumber: nextBatchNumber,
                  batchNo: batchNo,
                  qtyPerBatch: qtyPerBatch,
                  qtyAchieved: qtyAchieved,
                  totalBatchAdjusted: remainder,
                  combinedItems: combinedItems,
                  status: 'pending',
                  notes: `Remainder batch (${remainder}x${qtyPerBatch}=${qtyAchieved}) after removing ${actualProductId.toString().substring(0, 8)}`
                });
                
                await newBatch.save();
                console.log(`   ✅ Created new batch ${batchNo} for remainder ${remainder}`);
              }
            }
          } else {
            // No approved products left in group - delete all group batches
            const deleteResult = await ProductionBatch.deleteMany({
              groupId: productionGroup._id,
              companyId: masterProduct.companyId._id,
              productionDate: today,
              status: { $ne: 'completed' }
            });
            console.log(`   🗑️ Deleted all ${deleteResult.deletedCount} batches (no approved products left in group)`);
          }
        } else {
          // Ungrouped product - delete batches for this product
          console.log('   ⚠️ Product is NOT in a production group - deleting all its batches...');
          
          const deletedBatches = await ProductionBatch.deleteMany({
            "combinedItems.itemId": actualProductId,
            companyId: masterProduct.companyId._id,
            productionDate: today,
            status: { $ne: 'completed' }
          });
          
          console.log(`   🗑️ Deleted ${deletedBatches.deletedCount} batches for ungrouped product`);
          
          // Also delete by itemId for standalone products
          const deletedStandalone = await ProductionBatch.deleteMany({
            itemId: actualProductId,
            companyId: masterProduct.companyId._id,
            productionDate: today,
            status: { $ne: 'completed' }
          });
          
          if (deletedStandalone.deletedCount > 0) {
            console.log(`   🗑️ Deleted ${deletedStandalone.deletedCount} standalone batch records`);
          }
        }
      }
      // CASE 4: Fallback - Status changed to pending but no group found
      // This handles edge case where product is not in any group
      else if (updates.status === 'pending' && !productionGroup) {
        console.log('⚠️ Status set to pending - removing any orphaned batch records...');
        
        const today = new Date(summaryDate);
        today.setUTCHours(0, 0, 0, 0);
        
        // Unconditional delete for this product's batches
        const deletedByItem = await ProductionBatch.deleteMany({
          "combinedItems.itemId": actualProductId,
          companyId: masterProduct.companyId._id,
          productionDate: today,
          status: { $ne: 'completed' }
        });
        
        const deletedStandalone = await ProductionBatch.deleteMany({
          itemId: actualProductId,
          companyId: masterProduct.companyId._id,
          productionDate: today,
          status: { $ne: 'completed' }
        });
        
        const totalDeleted = deletedByItem.deletedCount + deletedStandalone.deletedCount;
        console.log(`   🗑️ Deleted ${totalDeleted} total batch records for pending product`);
        
        if (totalDeleted === 0) {
          console.log('   ℹ️ No batch records found to delete');
        }
      }
      // CASE 4: Status changed to completed - remove batches from ProductionBatch
      else if (updates.status === 'completed') {
        console.log('✅ Status changed to completed - removing batches from ProductionBatch...');
        
        const today = new Date(summaryDate);
        today.setUTCHours(0, 0, 0, 0);
        
        // Check if product is in a production group
        const productionGroup = await ProductionGroup.findOne({
          company: masterProduct.companyId._id,
          items: new mongoose.Types.ObjectId(actualProductId),
          isActive: true
        });
        
        if (productionGroup) {
          console.log(`   Product belongs to group: ${productionGroup.groupName}`);
          
          // Get remaining approved products (not completed) in this group
          const groupProductIds = productionGroup.items;
          const groupDailyDetails = await ProductDetailsDailySummary.find({
            date: today,
            productId: { $in: groupProductIds, $ne: new mongoose.Types.ObjectId(actualProductId) },
            companyId: masterProduct.companyId._id,
            status: 'approved'
          });
          
          // Calculate new group total without completed product
          const groupTotal = groupDailyDetails.reduce((sum, detail) => sum + (detail.batchAdjusted || 0), 0);
          console.log(`   📊 Group total without completed product: ${groupTotal}`);
          
          if (groupTotal > 0) {
            // Recalculate batches without the completed product (same logic as pending)
            const fullBatches = Math.floor(groupTotal);
            const remainder = parseFloat((groupTotal - fullBatches).toFixed(2));
            
            console.log(`   🎯 BATCH CALCULATION:`);
            console.log(`      Full batches to KEEP: ${fullBatches}`);
            console.log(`      Remainder for NEW batch: ${remainder}`);
            
            const existingBatches = await ProductionBatch.countDocuments({
              groupId: productionGroup._id,
              companyId: masterProduct.companyId._id,
              productionDate: today,
              status: { $ne: 'completed' }
            });
            
            let existingBatchDocs = await ProductionBatch.find({
              groupId: productionGroup._id,
              companyId: masterProduct.companyId._id,
              productionDate: today,
              status: { $ne: 'completed' }
            }).sort({ batchNumber: 1 });
            
            // Delete batches after fullBatches position
            if (existingBatches > fullBatches) {
              const batchesToRemove = existingBatchDocs.slice(fullBatches);
              const batchIds = batchesToRemove.map(b => b._id);
              
              if (batchIds.length > 0) {
                const deleteResult = await ProductionBatch.deleteMany({
                  _id: { $in: batchIds }
                });
                console.log(`   🗑️ Deleted ${deleteResult.deletedCount} batches after completing product`);
              }
            }
            
            // Create new batch for remainder if needed
            if (remainder > 0) {
              const nextBatchNumber = fullBatches + 1;
              const batchNo = `BATNO${String(nextBatchNumber).padStart(2, '0')}`;
              
              const combinedItems = groupDailyDetails.map(detail => ({
                itemId: detail.productId,
                DailyProductionId: detail._id,
                batchAdjustedValue: detail.batchAdjusted || 0,
                qtyContribution: detail.qtyPerBatch || 0
              }));
              
              const qtyPerBatch = groupDailyDetails[0]?.qtyPerBatch || 0;
              const qtyAchieved = parseFloat((qtyPerBatch * remainder).toFixed(2));
              
              const existingBatch = await ProductionBatch.findOne({
                companyId: masterProduct.companyId._id,
                batchNo: batchNo,
                productionDate: today
              });
              
              if (existingBatch) {
                existingBatch.qtyPerBatch = qtyPerBatch;
                existingBatch.qtyAchieved = qtyAchieved;
                existingBatch.totalBatchAdjusted = remainder;
                existingBatch.combinedItems = combinedItems;
                await existingBatch.save();
                console.log(`   ✅ Updated batch ${batchNo} without completed product`);
              } else {
                const newBatch = new ProductionBatch({
                  itemId: groupProductIds[0],
                  groupId: productionGroup._id,
                  companyId: masterProduct.companyId._id,
                  productionDate: today,
                  batchNumber: nextBatchNumber,
                  batchNo: batchNo,
                  qtyPerBatch: qtyPerBatch,
                  qtyAchieved: qtyAchieved,
                  totalBatchAdjusted: remainder,
                  status: 'pending',
                  combinedItems: combinedItems,
                  approvedBy: req.user.username,
                  createdAt: new Date()
                });
                await newBatch.save();
                console.log(`   ✅ Created batch ${batchNo} without completed product`);
              }
            }
          } else {
            // No approved products left - delete all batches for group
            const deleteResult = await ProductionBatch.deleteMany({
              groupId: productionGroup._id,
              companyId: masterProduct.companyId._id,
              productionDate: today,
              status: { $ne: 'completed' }
            });
            console.log(`   🗑️ Deleted all ${deleteResult.deletedCount} batches (no approved products left)`);
          }
        } else {
          // Ungrouped product - delete batches for this product
          const deletedBatches = await ProductionBatch.deleteMany({
            "combinedItems.itemId": actualProductId,
            companyId: masterProduct.companyId._id,
            productionDate: today,
            status: { $ne: 'completed' }
          });
          console.log(`   🗑️ Removed ${deletedBatches.deletedCount} batches for completed ungrouped product`);
        }
      }
    }
    // 🔄 NEW: For non–Unit Manager roles (Sales / Unit Head) ensure that
    // moving a product back to pending also clears any open ProductionBatch
    // entries so it no longer appears on the production sheet.
    else if (updates.status === 'pending') {
      console.log('⚠️ Non-Unit-Manager moved product to pending – clearing ProductionBatch records for this product/date');

      const today = new Date(summaryDate);
      today.setUTCHours(0, 0, 0, 0);

      const deletedByCombinedItem = await ProductionBatch.deleteMany({
        "combinedItems.itemId": actualProductId,
        companyId: masterProduct.companyId._id,
        productionDate: today,
        status: { $ne: 'completed' }
      });

      const deletedByDirectItem = await ProductionBatch.deleteMany({
        itemId: actualProductId,
        companyId: masterProduct.companyId._id,
        productionDate: today,
        status: { $ne: 'completed' }
      });

      console.log(`   🗑️ Deleted ${deletedByCombinedItem.deletedCount + deletedByDirectItem.deletedCount} ProductionBatch records for pending product (non-Unit-Manager)`);
    }

    // Return the updated daily details
    const response = {
      _id: dailyDetails._id,
      date: dailyDetails.date,
      productId: dailyDetails.productId,
      productName: masterProduct.productName,
      companyId: dailyDetails.companyId,
      qtyPerBatch: masterProduct.qtyPerBatch,
      
      // Daily fields
      packing: dailyDetails.packing,
      physicalStock: dailyDetails.physicalStock,
      batchAdjusted: dailyDetails.batchAdjusted,
      totalQuantity: dailyDetails.totalQuantity,
      totalIndent: dailyDetails.totalIndent,
      productionFinalBatches: dailyDetails.productionFinalBatches,
      toBeProducedDay: dailyDetails.toBeProducedDay,
      toBeProducedBatches: dailyDetails.toBeProducedBatches,
      produceBatches: dailyDetails.produceBatches,
      expiryShortage: dailyDetails.expiryShortage,
      balanceFinalBatches: dailyDetails.balanceFinalBatches,
      status: dailyDetails.status,
      
      updatedAt: dailyDetails.updatedAt
    };

    res.json({
      success: true,
      message: 'Product summary updated successfully',
      data: response
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

/**
 * Helper function to create ProductionBatch entries when Unit Manager approves products
 * This implements the new requirement for pre-creating batch entries with "pending" status
 */
const createProductionBatchEntries = async ({
  productId,
  companyId,
  date,
  qtyPerBatch,
  produceBatches,
  batchAdjusted = 1,
  approvedBy,
  dailyDetailsId
}) => {
  try {
    console.log('🏭 Creating ProductionBatch entries:', {
      productId,
      companyId,
      batchAdjusted,
      qtyPerBatch,
      approvedBy
    });

    // Validate inputs
    if (!batchAdjusted || batchAdjusted <= 0) {
      console.log(`⚠️ Invalid batchAdjusted value: ${batchAdjusted} - skipping ProductionBatch creation`);
      return [];
    }

    const today = new Date(date);
    today.setUTCHours(0, 0, 0, 0);

    // Check if this product is part of a production group
    const productionGroup = await ProductionGroup.findOne({
      company: companyId,
      items: productId,
      isActive: true
    });
    
    const groupId = productionGroup ? productionGroup._id : null;
    console.log(`🔗 Product ${groupId ? 'IS' : 'IS NOT'} part of a production group: ${groupId}`);

    // For UNGROUPED products we want behavior identical to bulk approve:
    // split batchAdjusted into full + remainder batches (e.g., 2.3 → 1,1,0.3)
    // and recreate all pending batches for this product/date.
    if (!groupId) {
      console.log('🔹 Ungrouped product – using split-batch logic like bulk approve');

      // Remove all existing pending/in-progress batches for this product on this date
      const deleteResult = await ProductionBatch.deleteMany({
        "combinedItems.itemId": productId,
        companyId,
        productionDate: today,
        status: { $ne: 'completed' },
        groupId: null
      });
      console.log(`   🗑️ Deleted ${deleteResult.deletedCount} existing ungrouped batches before recreation`);

      const fullBatches = Math.floor(batchAdjusted);
      const remainder = parseFloat((batchAdjusted - fullBatches).toFixed(2));
      console.log(`   📈 Splitting batchAdjusted=${batchAdjusted} into ${fullBatches} full + ${remainder} remainder`);

      // Find highest existing batch number for this date/company (after cleanup)
      const existingBatches = await ProductionBatch.find({
        companyId,
        productionDate: today
      }).select('batchNumber').sort({ batchNumber: -1 }).limit(1);

      let nextBatchNumber = 1;
      if (existingBatches.length > 0) {
        nextBatchNumber = existingBatches[0].batchNumber + 1;
      }

      const createdBatches = [];
      let batchCounter = 0;

      // Full batches (1.0 each)
      for (let i = 0; i < fullBatches; i++) {
        const currentBatchNumber = nextBatchNumber + batchCounter;
        const batchNo = `BATNO${String(currentBatchNumber).padStart(2, '0')}`;

        const batchEntry = await ProductionBatch.create({
          companyId,
          groupId: null,
          batchNumber: currentBatchNumber,
          batchNo,
          productionDate: today,
          qtyPerBatch: qtyPerBatch || 0,
          qtyAchieved: qtyPerBatch || 0,
          totalBatchAdjusted: 1.0,
          status: 'pending',
          mouldingTime: null,
          unloadingTime: null,
          productionLoss: 0,
          createdBy: approvedBy || 'system',
          combinedItems: [{
            itemId: productId,
            DailyProductionId: dailyDetailsId || null,
            batchAdjustedValue: 1.0,
            qtyContribution: qtyPerBatch || 0
          }],
          notes: ''
        });

        console.log(`   ✅ Created full batch ${batchNo}`);
        createdBatches.push(batchEntry);
        batchCounter++;
      }

      // Remainder batch, if any
      if (remainder > 0) {
        const currentBatchNumber = nextBatchNumber + batchCounter;
        const batchNo = `BATNO${String(currentBatchNumber).padStart(2, '0')}`;

        const batchEntry = await ProductionBatch.create({
          companyId,
          groupId: null,
          batchNumber: currentBatchNumber,
          batchNo,
          productionDate: today,
          qtyPerBatch: qtyPerBatch || 0,
          qtyAchieved: (qtyPerBatch || 0) * remainder,
          totalBatchAdjusted: remainder,
          status: 'pending',
          mouldingTime: null,
          unloadingTime: null,
          productionLoss: 0,
          createdBy: approvedBy || 'system',
          combinedItems: [{
            itemId: productId,
            DailyProductionId: dailyDetailsId || null,
            batchAdjustedValue: remainder,
            qtyContribution: (qtyPerBatch || 0) * remainder
          }],
          notes: ''
        });

        console.log(`   ✅ Created remainder batch ${batchNo} with totalBatchAdjusted=${remainder}`);
        createdBatches.push(batchEntry);
      }

      console.log(`   ✅ Created ${createdBatches.length} ungrouped batches for product`);
      return createdBatches;
    }

    // GROUPED products keep SMART REUSE behavior to pack items into combined batches
    const existingPartialBatches = await ProductionBatch.find({
      companyId,
      groupId,
      productionDate: today,
      status: 'pending',
      totalBatchAdjusted: { $lt: 1.0 }
    }).sort({ createdAt: 1 });
    
    console.log(`🔍 Found ${existingPartialBatches.length} existing partial group batches with space`);
    
    for (const existingBatch of existingPartialBatches) {
      const availableSpace = parseFloat((1.0 - existingBatch.totalBatchAdjusted).toFixed(2));
      console.log(`   📊 ${existingBatch.batchNo}: ${existingBatch.totalBatchAdjusted.toFixed(2)} used, ${availableSpace.toFixed(2)} available`);

      if (batchAdjusted <= availableSpace) {
        console.log(`✅ Adding to existing group batch ${existingBatch.batchNo}: ${batchAdjusted} fits in ${availableSpace} space`);

        existingBatch.combinedItems.push({
          itemId: productId,
          DailyProductionId: dailyDetailsId || null,
          batchAdjustedValue: batchAdjusted,
          qtyContribution: qtyPerBatch
        });

        const oldTotal = existingBatch.totalBatchAdjusted;
        existingBatch.totalBatchAdjusted = parseFloat(
          (existingBatch.totalBatchAdjusted + batchAdjusted).toFixed(2)
        );

        existingBatch.notes = `${existingBatch.notes || 'Combined batch'} + ${batchAdjusted} = ${existingBatch.totalBatchAdjusted.toFixed(2)}`;
        await existingBatch.save();

        console.log(`🎉 Successfully added to existing group batch ${existingBatch.batchNo}: ${oldTotal.toFixed(2)} → ${existingBatch.totalBatchAdjusted.toFixed(2)}`);
        return [existingBatch];
      }
    }

    console.log(`📦 No existing group batch can fit ${batchAdjusted}, creating new group batch...`);

    const existingBatches = await ProductionBatch.find({
      companyId,
      productionDate: today
    }).select('batchNumber').sort({ batchNumber: -1 }).limit(1);

    let nextBatchNumber = 1;
    if (existingBatches.length > 0) {
      nextBatchNumber = existingBatches[0].batchNumber + 1;
    }

    const batchNo = `BATNO${String(nextBatchNumber).padStart(2, '0')}`;

    const newBatch = await ProductionBatch.create({
      companyId,
      groupId,
      batchNumber: nextBatchNumber,
      batchNo,
      productionDate: today,
      qtyPerBatch,
      qtyAchieved: qtyPerBatch,
      productionLoss: 0,
      status: 'pending',
      mouldingTime: null,
      unloadingTime: null,
      createdBy: approvedBy,
      totalBatchAdjusted: batchAdjusted,
      combinedItems: [{
        itemId: productId,
        DailyProductionId: dailyDetailsId || null,
        batchAdjustedValue: batchAdjusted,
        qtyContribution: qtyPerBatch
      }],
      notes: `Created with batch value ${batchAdjusted}`
    });

    console.log(`✅ Created new group batch ${batchNo} with value ${batchAdjusted}`);
    return [newBatch];
    
  } catch (error) {
    console.error('❌ Error creating ProductionBatch entries:', error);
    console.error('⚠️ ProductionBatch creation failed but product approval will continue');
    return [];
  }
};