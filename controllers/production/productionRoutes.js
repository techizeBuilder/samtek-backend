import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { checkRole } from '../../middleware/roleMiddleware.js';
import { BatchPlan, ProductionBatch, ProductionRecord } from '../../models/production/Production.js';
import {
  getProductionDashboard,
  getBatchPlans,
  createBatchPlan,
  updateBatchPlan,
  approveBatchPlan,
  getProductionBatches,
  createProductionBatch,
  updateProductionBatch,
  getProductionRecords,
  createProductionRecord,
  updateProductionRecord,
  getPendingVerifications,
  verifyProduction
} from './productionController.js';

const router = express.Router();

// Apply authentication middleware to all production routes
router.use(authenticateToken);

// Dashboard Routes (Both Super Admin and Unit Head can view)
router.get('/dashboard', 
  checkRole(['Super Admin', 'Unit Head']), 
  getProductionDashboard
);

// Batch Planning Routes
router.get('/batch-plans', 
  checkRole(['Super Admin', 'Unit Head']), 
  getBatchPlans
);

router.post('/batch-plans', 
  checkRole(['Super Admin', 'Unit Head']), 
  createBatchPlan
);

router.put('/batch-plans/:id', 
  checkRole(['Super Admin', 'Unit Head']), 
  updateBatchPlan
);

router.patch('/batch-plans/:id/approve', 
  checkRole(['Super Admin', 'Unit Head']), 
  approveBatchPlan
);

// Production Execution Routes
router.get('/batches', 
  checkRole(['Super Admin', 'Unit Head']), 
  getProductionBatches
);

router.post('/batches', 
  checkRole(['Super Admin', 'Unit Head']), 
  createProductionBatch
);

router.put('/batches/:id', 
  checkRole(['Super Admin', 'Unit Head']), 
  updateProductionBatch
);

// Production Register Routes
router.get('/records', 
  checkRole(['Super Admin', 'Unit Head']), 
  getProductionRecords
);

router.post('/records', 
  checkRole(['Super Admin', 'Unit Head']), 
  createProductionRecord
);

router.put('/records/:id', 
  checkRole(['Super Admin', 'Unit Head']), 
  updateProductionRecord
);

// Verification & Approval Routes
router.get('/verifications/pending', 
  checkRole(['Super Admin', 'Unit Head']), 
  getPendingVerifications
);

router.post('/verify/:id', 
  checkRole(['Super Admin', 'Unit Head']), 
  verifyProduction
);

// Additional Production Routes

// Delete Routes (Super Admin only for safety)
router.delete('/batch-plans/:id', 
  checkRole(['Super Admin']), 
  async (req, res) => {
    try {
      const { id } = req.params;
      await BatchPlan.findByIdAndDelete(id);
      
      res.json({
        success: true,
        message: 'Batch plan deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error deleting batch plan',
        error: error.message
      });
    }
  }
);

router.delete('/batches/:id', 
  checkRole(['Super Admin']), 
  async (req, res) => {
    try {
      const { id } = req.params;
      await ProductionBatch.findByIdAndDelete(id);
      
      res.json({
        success: true,
        message: 'Production batch deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error deleting production batch',
        error: error.message
      });
    }
  }
);

router.delete('/records/:id', 
  checkRole(['Super Admin']), 
  async (req, res) => {
    try {
      const { id } = req.params;
      await ProductionRecord.findByIdAndDelete(id);
      
      res.json({
        success: true,
        message: 'Production record deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error deleting production record',
        error: error.message
      });
    }
  }
);

// Bulk Operations (Super Admin only)
router.post('/batch-plans/bulk-approve', 
  checkRole(['Super Admin']), 
  async (req, res) => {
    try {
      const { planIds } = req.body;
      const user = req.user;

      await BatchPlan.updateMany(
        { _id: { $in: planIds } },
        { 
          status: 'Approved',
          approvedBy: user.id,
          approvedAt: new Date()
        }
      );

      res.json({
        success: true,
        message: `${planIds.length} batch plans approved successfully`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error bulk approving batch plans',
        error: error.message
      });
    }
  }
);

// Reports Routes
router.get('/reports/production-summary', 
  checkRole(['Super Admin', 'Unit Head']), 
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const user = req.user;
      
      let query = {};
      if (user.role === 'Unit Head' && user.companyId) {
        query.companyId = user.companyId;
      }
      
      if (startDate && endDate) {
        query.createdAt = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      }

      const [batchesReport, recordsReport] = await Promise.all([
        ProductionBatch.aggregate([
          { $match: query },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              totalQuantity: { $sum: '$totalOutput' }
            }
          }
        ]),
        ProductionRecord.aggregate([
          { $match: query },
          {
            $group: {
              _id: null,
              totalRecords: { $sum: 1 },
              totalProduced: { $sum: '$finalQuantity' },
              totalDamages: { $sum: '$damages.quantity' }
            }
          }
        ])
      ]);

      res.json({
        success: true,
        data: {
          batches: batchesReport,
          records: recordsReport[0] || { totalRecords: 0, totalProduced: 0, totalDamages: 0 }
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error generating production summary',
        error: error.message
      });
    }
  }
);

export default router;