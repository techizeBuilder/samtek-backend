import ProductDetailsDailySummary from '../models/ProductDetailsDailySummary.js';
import ProductionBatch from '../models/ProductionBatch.js';
import mongoose from 'mongoose';

/**
 * POST /api/unit-manager/bulk-approve-group
 * Bulk approve all items in a production group and create OPTIMAL combined batches
 */
export const bulkApproveGroup = async (req, res) => {
  try {
    const { groupName, groupId, date, products } = req.body;
    const userRole = req.user.role;
    const userCompanyId = req.user.companyId;

    console.log('🎯 BULK GROUP APPROVAL:', { groupName, groupId, date, productsCount: products?.length, userRole });

    // Validate user permissions
    if (userRole !== 'Unit Manager' && userRole !== 'Superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Only Unit Manager or Super Admin can approve products'
      });
    }

    // Validate products array
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Products array is required and must not be empty'
      });
    }

    // Parse date - handle UTC properly
    let approvalDate;
    if (date) {
      approvalDate = new Date(date);
      approvalDate.setUTCHours(0, 0, 0, 0);
    } else {
      const now = new Date();
      approvalDate = new Date(Date.UTC(
        now.getUTCFullYear(), 
        now.getUTCMonth(), 
        now.getUTCDate(), 
        0, 0, 0, 0
      ));
    }

    console.log(`📅 Approval date: ${approvalDate.toISOString()}`);
    console.log(`📦 Processing ${products.length} products in group "${groupName}"`);

    // Step 1: Update all ProductDetailsDailySummary entries
    const approvalResults = [];
    const productDataForBatching = [];

    for (const productData of products) {
      try {
        const { productId, productName, batchAdjusted, qtyPerBatch, physicalStock, packing, orderIds, dailyDetailsId } = productData;

        // Skip products with 0 or null batchAdjusted
        if (!batchAdjusted || batchAdjusted <= 0) {
          console.log(`⏭️ Skipping ${productName} (batchAdjusted: ${batchAdjusted})`);
          approvalResults.push({
            productId,
            productName,
            status: 'skipped',
            reason: 'batchAdjusted is 0 or null'
          });
          continue;
        }

        console.log(`📋 Processing ${productName} with batchAdjusted: ${batchAdjusted}`);

        // Find and update the ProductDetailsDailySummary
        const updatedSummary = await ProductDetailsDailySummary.findOneAndUpdate(
          {
            productId: productId,
            companyId: userCompanyId,
            date: approvalDate
          },
          {
            status: 'approved',
            batchAdjusted: batchAdjusted,
            qtyPerBatch: qtyPerBatch,
            physicalStock: physicalStock,
            packing: packing,
            ...(orderIds && Array.isArray(orderIds) && orderIds.length > 0 && {
              orderIds: orderIds.map(id => new mongoose.Types.ObjectId(id))
            })
          },
          { new: true }
        );

        if (updatedSummary) {
          // Collect data for batch creation
          productDataForBatching.push({
            productId: productId,
            productName: productName,
            batchAdjusted: batchAdjusted,
            qtyPerBatch: qtyPerBatch || 1,
            approvedBy: req.user.username,
            dailyDetailsId: updatedSummary._id
          });

          approvalResults.push({
            productId,
            productName,
            status: 'approved',
            batchAdjusted: batchAdjusted
          });

          console.log(`✅ Approved ${productName} with batchAdjusted: ${batchAdjusted}`);
        } else {
          console.log(`⚠️ Product summary not found for ${productName}`);
          approvalResults.push({
            productId,
            productName,
            status: 'not_found'
          });
        }
      } catch (error) {
        console.error(`❌ Error processing ${productData.productName}:`, error);
        approvalResults.push({
          productId: productData.productId,
          productName: productData.productName,
          status: 'error',
          error: error.message
        });
      }
    }

    if (productDataForBatching.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid items to approve (all items have batchAdjusted = 0)',
        details: approvalResults
      });
    }

    console.log(`✅ Successfully approved ${productDataForBatching.length} products`);

    // Step 2: Calculate total batchAdjusted and required batches
    const totalBatchAdjusted = productDataForBatching.reduce((sum, item) => sum + item.batchAdjusted, 0);
    const requiredBatches = Math.ceil(totalBatchAdjusted);
    
    console.log(`📊 Total batchAdjusted: ${totalBatchAdjusted.toFixed(2)}`);
    console.log(`📊 Required batches: ${requiredBatches}`);

    // Step 3: Check existing batches for this group today
    // FIXED: Explicitly filter by groupId (including null for ungrouped items)
    const existingBatches = await ProductionBatch.countDocuments({
      companyId: userCompanyId,
      productionDate: approvalDate,
      groupId: groupId || null,
      'combinedItems.DailyProductionId': { $in: productDataForBatching.map(p => p.dailyDetailsId) }
    });
    
    console.log(`📦 Existing batches for groupId ${groupId || 'null'}: ${existingBatches}`);

    // Step 4: Calculate how many new batches to create
    const batchesToCreate = Math.max(0, requiredBatches - existingBatches);
    
    console.log(`✨ Batches to create: ${batchesToCreate}`);

    if (batchesToCreate === 0) {
      console.log('✅ No new batches needed - existing batches are sufficient');
      return res.json({
        success: true,
        message: `Group "${groupName}" already has sufficient batches (${existingBatches} existing)`,
        data: {
          groupName: groupName,
          itemsApproved: productDataForBatching.length,
          batchesCreated: 0,
          existingBatches: existingBatches,
          batches: [],
          items: approvalResults
        }
      });
    }

    // Step 5: Create only the additional batches needed
    console.log('🏭 Creating additional ProductionBatch entries...');
    const createdBatches = await createGroupBatches({
      items: productDataForBatching,
      companyId: userCompanyId,
      groupId: groupId,
      groupName: groupName,
      date: approvalDate,
      approvedBy: req.user.username,
      batchesToCreate: batchesToCreate,
      totalBatchAdjusted: totalBatchAdjusted
    });

    console.log(`✅ Bulk approval completed:`, {
      itemsApproved: productDataForBatching.length,
      batchesCreated: createdBatches.length
    });

    res.json({
      success: true,
      message: `Successfully approved ${productDataForBatching.length} items in group "${groupName}" and created ${createdBatches.length} optimal batches`,
      data: {
        groupName: groupName,
        itemsApproved: productDataForBatching.length,
        batchesCreated: createdBatches.length,
        batches: createdBatches.map(b => ({
          batchNo: b.batchNo,
          totalBatchAdjusted: b.totalBatchAdjusted,
          itemCount: b.combinedItems.length
        })),
        items: approvalResults
      }
    });

  } catch (error) {
    console.error('❌ Error in bulk group approval:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Create group batches where each batch contains ALL items
 * Each batch has totalBatchAdjusted = 1.0 and includes all products proportionally
 */
const createGroupBatches = async ({
  items,
  companyId,
  groupId,
  groupName,
  date,
  approvedBy,
  batchesToCreate,
  totalBatchAdjusted
}) => {
  console.log('🧮 Creating group batches...');
  console.log('🏷️ Group ID:', groupId);
  console.log('📊 Batches to create:', batchesToCreate);

  const today = new Date(date);
  today.setUTCHours(0, 0, 0, 0);

  // Get next batch number
  const existingBatches = await ProductionBatch.find({
    companyId,
    productionDate: today
  }).select('batchNumber').sort({ batchNumber: -1 }).limit(1);

  let nextBatchNumber = existingBatches.length > 0 ? existingBatches[0].batchNumber + 1 : 1;

  const createdBatches = [];

  // Create the specified number of batches
  for (let i = 0; i < batchesToCreate; i++) {
    const batchNo = `BATNO${String(nextBatchNumber).padStart(2, '0')}`;

    // Each batch contains ALL items from the group
    const combinedItems = items.map(item => ({
      itemId: item.productId,
      DailyProductionId: item.dailyDetailsId,
      batchAdjustedValue: item.batchAdjusted, // Original value for reference
      qtyContribution: item.qtyPerBatch
    }));

    const productionBatch = await ProductionBatch.create({
      companyId,
      groupId: groupId || null,
      batchNumber: nextBatchNumber,
      batchNo,
      productionDate: today,
      qtyPerBatch: items[0]?.qtyPerBatch || 234,
      qtyAchieved: items[0]?.qtyPerBatch || 234,
      productionLoss: 0,
      status: 'pending',
      totalBatchAdjusted: 1.0, // Each batch = 1.0
      combinedItems,
      createdBy: approvedBy,
      notes: `Group: ${groupName} | Combined batch (${items.length} items, 1.0 total) | Group total: ${totalBatchAdjusted.toFixed(2)}`
    });

    createdBatches.push(productionBatch);
    console.log(`   ✅ ${batchNo}: 1.0 (${items.length} items)`);
    
    nextBatchNumber++;
  }

  return createdBatches;
};

export default { bulkApproveGroup };
