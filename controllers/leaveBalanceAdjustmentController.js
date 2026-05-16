import LeaveBalanceAdjustment from "../models/LeaveBalanceAdjustment.js";
import Leave from "../models/Leave.js";
import LeaveType from "../models/LeaveType.js";
import User from "../models/User.js";
import mongoose from "mongoose";

// GET /my-balances
export const getMyBalances = async (req, res) => {
    try {
        const empObjectId = new mongoose.Types.ObjectId(req.user._id);
        const leaveTypes = await LeaveType.find({ isActive: true });
        
        const balances = await Promise.all(leaveTypes.map(async (lt) => {
            const usedAgg = await Leave.aggregate([
              { $match: { employee: empObjectId, leaveType: lt.name, status: "APPROVED" } },
              { $group: { _id: null, total: { $sum: "$totalDays" } } }
            ]);
            const usedLeaves = usedAgg[0]?.total || 0;
            
            const adjAgg = await LeaveBalanceAdjustment.aggregate([
              { $match: { employee: empObjectId, leaveType: lt.name } },
              { $group: { _id: null, total: { $sum: "$adjustment" } } }
            ]);
            const totalAdjustments = adjAgg[0]?.total || 0;
            
            return {
                leaveType: lt.name,
                balance: lt.maxDays + totalAdjustments - usedLeaves
            };
        }));
        
        res.json(balances);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch balances" });
    }
};

// GET /current?employeeId=...&leaveType=...
export const getCurrentBalance = async (req, res) => {
    try {
        const { employeeId, leaveType } = req.query;
        if (!employeeId || !leaveType) return res.status(400).json({ message: "Missing params" });
        
        const empObjectId = new mongoose.Types.ObjectId(employeeId);
        const ltDoc = await LeaveType.findOne({ name: leaveType });
        if (!ltDoc) return res.status(404).json({ message: "Leave type not found" });
        
        const usedAgg = await Leave.aggregate([
          { $match: { employee: empObjectId, leaveType: leaveType, status: "APPROVED" } },
          { $group: { _id: null, total: { $sum: "$totalDays" } } }
        ]);
        const usedLeaves = usedAgg[0]?.total || 0;
        
        const adjAgg = await LeaveBalanceAdjustment.aggregate([
          { $match: { employee: empObjectId, leaveType: leaveType } },
          { $group: { _id: null, total: { $sum: "$adjustment" } } }
        ]);
        const totalAdjustments = adjAgg[0]?.total || 0;
        
        res.json({ balance: ltDoc.maxDays + totalAdjustments - usedLeaves });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch balance" });
    }
};

// GET /history
export const getHistory = async (req, res) => {
    try {
        const history = await LeaveBalanceAdjustment.find()
            .populate('employee', 'name fullName employeeId role')
            .populate('addedBy', 'name fullName role')
            .sort({ createdAt: -1 });
        res.json(history);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch history" });
    }
};

// POST /override
export const overrideBalance = async (req, res) => {
    try {
        const { employeeId, leaveType, newBalance, reason } = req.body;
        
        const empObjectId = new mongoose.Types.ObjectId(employeeId);
        const ltDoc = await LeaveType.findOne({ name: leaveType });
        if (!ltDoc) return res.status(404).json({ message: "Leave type not found" });
        
        const usedAgg = await Leave.aggregate([
          { $match: { employee: empObjectId, leaveType: leaveType, status: "APPROVED" } },
          { $group: { _id: null, total: { $sum: "$totalDays" } } }
        ]);
        const usedLeaves = usedAgg[0]?.total || 0;
        
        const adjAgg = await LeaveBalanceAdjustment.aggregate([
          { $match: { employee: empObjectId, leaveType: leaveType } },
          { $group: { _id: null, total: { $sum: "$adjustment" } } }
        ]);
        const totalAdjustments = adjAgg[0]?.total || 0;
        
        const currentBalance = ltDoc.maxDays + totalAdjustments - usedLeaves;
        const adjustment = Number(newBalance) - currentBalance;
        
        const override = new LeaveBalanceAdjustment({
            employee: employeeId,
            leaveType,
            oldBalance: currentBalance,
            newBalance: Number(newBalance),
            adjustment,
            reason,
            addedBy: req.user._id
        });
        await override.save();
        
        res.json({ message: "Balance overridden successfully", override });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to override balance" });
    }
};
