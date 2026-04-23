import Manufacturing from '../models/Manufacturing.js';
import Order from '../models/Order.js';
import { Inventory } from '../models/Inventory.js';
import { USER_ROLES } from '../../shared/schema.js';

export const getManufacturingJobs = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, unit, search } = req.query;
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

    if (search) {
      query.$or = [
        { jobNumber: { $regex: search, $options: 'i' } },
        { productName: { $regex: search, $options: 'i' } }
      ];
    }

    const jobs = await Manufacturing.find(query)
      .populate('order', 'orderNumber customer')
      .populate('assignedWorkers', 'fullName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Manufacturing.countDocuments(query);

    res.json({
      jobs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get manufacturing jobs error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getManufacturingJobById = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Manufacturing.findById(id)
      .populate('order')
      .populate('assignedWorkers', 'fullName')
      .populate('materialUsage.materialId', 'itemName');

    if (!job) {
      return res.status(404).json({ message: 'Manufacturing job not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && job.unit !== req.user.unit) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ job });
  } catch (error) {
    console.error('Get manufacturing job by ID error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const createManufacturingJob = async (req, res) => {
  try {
    const {
      order,
      productName,
      plannedQuantity,
      startDate,
      expectedEndDate,
      assignedWorkers,
      machineUsed,
      materialUsage,
      notes
    } = req.body;

    if (!order || !productName || !plannedQuantity || !startDate || !expectedEndDate) {
      return res.status(400).json({ message: 'Required fields are missing' });
    }

    // Validate order exists
    const orderDoc = await Order.findById(order);
    if (!orderDoc) {
      return res.status(400).json({ message: 'Order not found' });
    }

    const jobData = {
      order,
      productName,
      plannedQuantity,
      startDate: new Date(startDate),
      expectedEndDate: new Date(expectedEndDate),
      unit: req.user.role === USER_ROLES.SUPER_USER ? req.body.unit : req.user.unit,
      assignedWorkers: assignedWorkers || [],
      machineUsed,
      materialUsage: materialUsage || [],
      notes
    };

    const job = await Manufacturing.create(jobData);
    await job.populate('order', 'orderNumber customer');

    res.status(201).json({
      message: 'Manufacturing job created successfully',
      job
    });
  } catch (error) {
    console.error('Create manufacturing job error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateManufacturingJob = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      actualQuantity,
      status,
      actualEndDate,
      assignedWorkers,
      machineUsed,
      materialUsage,
      qualityCheckPassed,
      notes,
      efficiency
    } = req.body;

    const job = await Manufacturing.findById(id);

    if (!job) {
      return res.status(404).json({ message: 'Manufacturing job not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && job.unit !== req.user.unit) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updateData = {};

    if (actualQuantity !== undefined) updateData.actualQuantity = actualQuantity;
    if (status) updateData.status = status;
    if (actualEndDate) updateData.actualEndDate = new Date(actualEndDate);
    if (assignedWorkers) updateData.assignedWorkers = assignedWorkers;
    if (machineUsed) updateData.machineUsed = machineUsed;
    if (materialUsage) updateData.materialUsage = materialUsage;
    if (typeof qualityCheckPassed === 'boolean') updateData.qualityCheckPassed = qualityCheckPassed;
    if (notes) updateData.notes = notes;
    if (efficiency !== undefined) updateData.efficiency = efficiency;

    const updatedJob = await Manufacturing.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('order', 'orderNumber customer')
     .populate('assignedWorkers', 'fullName');

    res.json({
      message: 'Manufacturing job updated successfully',
      job: updatedJob
    });
  } catch (error) {
    console.error('Update manufacturing job error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const deleteManufacturingJob = async (req, res) => {
  try {
    const { id } = req.params;

    const job = await Manufacturing.findById(id);

    if (!job) {
      return res.status(404).json({ message: 'Manufacturing job not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && job.unit !== req.user.unit) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (['In Progress', 'Completed'].includes(job.status)) {
      return res.status(400).json({ message: 'Cannot delete job that is in progress or completed' });
    }

    await Manufacturing.findByIdAndDelete(id);

    res.json({ message: 'Manufacturing job deleted successfully' });
  } catch (error) {
    console.error('Delete manufacturing job error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getManufacturingStats = async (req, res) => {
  try {
    const { unit } = req.query;
    let query = {};

    if (req.user.role !== USER_ROLES.SUPER_USER) {
      query.unit = req.user.unit;
    } else if (unit) {
      query.unit = unit;
    }

    const stats = await Manufacturing.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalPlanned: { $sum: '$plannedQuantity' },
          totalActual: { $sum: '$actualQuantity' }
        }
      }
    ]);

    const totalJobs = await Manufacturing.countDocuments(query);
    const avgEfficiency = await Manufacturing.aggregate([
      { $match: { ...query, efficiency: { $exists: true } } },
      { $group: { _id: null, avg: { $avg: '$efficiency' } } }
    ]);

    res.json({
      stats,
      totalJobs,
      avgEfficiency: avgEfficiency.length > 0 ? avgEfficiency[0].avg : 0
    });
  } catch (error) {
    console.error('Get manufacturing stats error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
