import { 
  BatchPlan, 
  ProductionBatch, 
  ProductionRecord, 
  ProductionVerification 
} from '../../models/production/Production.js';

// Dashboard Controllers
export const getProductionDashboard = async (req, res) => {
  try {
    const user = req.user;
    let query = {};
    
    // Role-based filtering
    if (user.role === 'Unit Head' && user.companyId) {
      query.companyId = user.companyId;
    }

    // Get today's date range
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    // Fetch dashboard statistics
    const [
      totalBatches,
      pendingTasks,
      ongoingBatches,
      completedBatches,
      recentBatches,
      damages
    ] = await Promise.all([
      ProductionBatch.countDocuments({
        ...query,
        createdAt: { $gte: startOfDay, $lt: endOfDay }
      }),
      ProductionBatch.countDocuments({
        ...query,
        status: { $in: ['Ready', 'Paused'] }
      }),
      ProductionBatch.countDocuments({
        ...query,
        status: 'In Progress'
      }),
      ProductionBatch.countDocuments({
        ...query,
        status: 'Completed',
        createdAt: { $gte: startOfDay, $lt: endOfDay }
      }),
      ProductionBatch.find({
        ...query,
        status: 'In Progress'
      }).limit(10).sort({ createdAt: -1 }),
      ProductionBatch.aggregate([
        { $match: { ...query, createdAt: { $gte: startOfDay, $lt: endOfDay } } },
        { $unwind: '$damages' },
        { 
          $group: {
            _id: null,
            totalDamages: { $sum: '$damages.quantity' },
            totalCost: { $sum: '$damages.cost' }
          }
        }
      ])
    ]);

    const damagesSummary = damages.length > 0 ? damages[0] : { totalDamages: 0, totalCost: 0 };

    res.json({
      success: true,
      data: {
        overview: {
          totalBatches,
          pendingTasks,
          ongoingBatches,
          completedBatches,
          damages: damagesSummary.totalDamages,
          damagesCost: damagesSummary.totalCost,
          efficiency: 95.5 // Calculate based on actual data
        },
        recentBatches,
        alerts: [
          {
            type: 'warning',
            message: 'Low raw material stock for Product A',
            time: '10 mins ago'
          },
          {
            type: 'info',
            message: 'Quality check passed for BATCH003',
            time: '1 hour ago'
          }
        ]
      }
    });
  } catch (error) {
    console.error('Production dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching production dashboard data',
      error: error.message
    });
  }
};

// Batch Planning Controllers
export const getBatchPlans = async (req, res) => {
  try {
    const user = req.user;
    let query = {};
    
    if (user.role === 'Unit Head' && user.companyId) {
      query.companyId = user.companyId;
    }

    const plans = await BatchPlan.find(query)
      .populate('createdBy', 'username')
      .populate('approvedBy', 'username')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { plans }
    });
  } catch (error) {
    console.error('Get batch plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching batch plans',
      error: error.message
    });
  }
};

export const createBatchPlan = async (req, res) => {
  try {
    const user = req.user;
    const planData = req.body;

    // Generate unique plan ID
    const planId = `BP${Date.now().toString().slice(-6)}`;

    const newPlan = new BatchPlan({
      ...planData,
      planId,
      createdBy: user.id,
      companyId: user.companyId
    });

    await newPlan.save();

    res.status(201).json({
      success: true,
      message: 'Batch plan created successfully',
      data: { plan: newPlan }
    });
  } catch (error) {
    console.error('Create batch plan error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating batch plan',
      error: error.message
    });
  }
};

export const updateBatchPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const user = req.user;

    let query = { _id: id };
    if (user.role === 'Unit Head' && user.companyId) {
      query.companyId = user.companyId;
    }

    const updatedPlan = await BatchPlan.findOneAndUpdate(
      query,
      updateData,
      { new: true }
    );

    if (!updatedPlan) {
      return res.status(404).json({
        success: false,
        message: 'Batch plan not found'
      });
    }

    res.json({
      success: true,
      message: 'Batch plan updated successfully',
      data: { plan: updatedPlan }
    });
  } catch (error) {
    console.error('Update batch plan error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating batch plan',
      error: error.message
    });
  }
};

export const approveBatchPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    let query = { _id: id };
    if (user.role === 'Unit Head' && user.companyId) {
      query.companyId = user.companyId;
    }

    const updatedPlan = await BatchPlan.findOneAndUpdate(
      query,
      {
        status: 'Approved',
        approvedBy: user.id,
        approvedAt: new Date()
      },
      { new: true }
    );

    if (!updatedPlan) {
      return res.status(404).json({
        success: false,
        message: 'Batch plan not found'
      });
    }

    res.json({
      success: true,
      message: 'Batch plan approved successfully',
      data: { plan: updatedPlan }
    });
  } catch (error) {
    console.error('Approve batch plan error:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving batch plan',
      error: error.message
    });
  }
};

// Production Execution Controllers
export const getProductionBatches = async (req, res) => {
  try {
    const user = req.user;
    let query = {};
    
    if (user.role === 'Unit Head' && user.companyId) {
      query.companyId = user.companyId;
    }

    const batches = await ProductionBatch.find(query)
      .populate('planId', 'planId indentId')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { batches }
    });
  } catch (error) {
    console.error('Get production batches error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching production batches',
      error: error.message
    });
  }
};

export const createProductionBatch = async (req, res) => {
  try {
    const user = req.user;
    const batchData = req.body;

    // Generate unique batch ID
    const batchId = `BATCH${Date.now().toString().slice(-6)}`;

    const newBatch = new ProductionBatch({
      ...batchData,
      batchId,
      companyId: user.companyId
    });

    await newBatch.save();

    res.status(201).json({
      success: true,
      message: 'Production batch created successfully',
      data: { batch: newBatch }
    });
  } catch (error) {
    console.error('Create production batch error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating production batch',
      error: error.message
    });
  }
};

export const updateProductionBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const user = req.user;

    let query = { _id: id };
    if (user.role === 'Unit Head' && user.companyId) {
      query.companyId = user.companyId;
    }

    const updatedBatch = await ProductionBatch.findOneAndUpdate(
      query,
      updateData,
      { new: true }
    );

    if (!updatedBatch) {
      return res.status(404).json({
        success: false,
        message: 'Production batch not found'
      });
    }

    res.json({
      success: true,
      message: 'Production batch updated successfully',
      data: { batch: updatedBatch }
    });
  } catch (error) {
    console.error('Update production batch error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating production batch',
      error: error.message
    });
  }
};

// Production Register Controllers
export const getProductionRecords = async (req, res) => {
  try {
    const user = req.user;
    let query = {};
    
    if (user.role === 'Unit Head' && user.companyId) {
      query.companyId = user.companyId;
    }

    const records = await ProductionRecord.find(query)
      .populate('batchId', 'batchId productName')
      .populate('verifiedBy', 'username')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { records }
    });
  } catch (error) {
    console.error('Get production records error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching production records',
      error: error.message
    });
  }
};

export const createProductionRecord = async (req, res) => {
  try {
    const user = req.user;
    const recordData = req.body;

    // Generate unique record ID
    const recordId = `PR${Date.now().toString().slice(-6)}`;

    const newRecord = new ProductionRecord({
      ...recordData,
      recordId,
      companyId: user.companyId
    });

    await newRecord.save();

    res.status(201).json({
      success: true,
      message: 'Production record created successfully',
      data: { record: newRecord }
    });
  } catch (error) {
    console.error('Create production record error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating production record',
      error: error.message
    });
  }
};

export const updateProductionRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const user = req.user;

    let query = { _id: id };
    if (user.role === 'Unit Head' && user.companyId) {
      query.companyId = user.companyId;
    }

    const updatedRecord = await ProductionRecord.findOneAndUpdate(
      query,
      updateData,
      { new: true }
    );

    if (!updatedRecord) {
      return res.status(404).json({
        success: false,
        message: 'Production record not found'
      });
    }

    res.json({
      success: true,
      message: 'Production record updated successfully',
      data: { record: updatedRecord }
    });
  } catch (error) {
    console.error('Update production record error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating production record',
      error: error.message
    });
  }
};

// Production Verification Controllers
export const getPendingVerifications = async (req, res) => {
  try {
    const user = req.user;
    let query = { status: 'Pending Verification' };
    
    if (user.role === 'Unit Head' && user.companyId) {
      query.companyId = user.companyId;
    }

    const pendingBatches = await ProductionBatch.find(query)
      .populate('planId', 'planId indentId')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { batches: pendingBatches }
    });
  } catch (error) {
    console.error('Get pending verifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching pending verifications',
      error: error.message
    });
  }
};

export const verifyProduction = async (req, res) => {
  try {
    const { id } = req.params;
    const verificationData = req.body;
    const user = req.user;

    // Generate unique verification ID
    const verificationId = `VER${Date.now().toString().slice(-6)}`;

    const verification = new ProductionVerification({
      ...verificationData,
      verificationId,
      verifiedBy: user.id,
      companyId: user.companyId
    });

    await verification.save();

    // Update the production batch status
    await ProductionBatch.findByIdAndUpdate(id, {
      status: verificationData.approvalStatus === 'Approved' ? 'Verified' : 'Rejected'
    });

    res.json({
      success: true,
      message: 'Production verification completed successfully',
      data: { verification }
    });
  } catch (error) {
    console.error('Verify production error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying production',
      error: error.message
    });
  }
};