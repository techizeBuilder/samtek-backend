/** @format */

import SalaryStructure from "../models/SalaryStructure.js";
import User from "../models/User.js";

/**
 * ➕ Add Salary Structure
 */
export const addSalaryStructure = async (req, res) => {
  try {
    const { 
      employee, basic, hra, otherAllowance, pf, professionalTax, tds, advance, others 
    } = req.body;

    if (!employee) {
      return res.status(400).json({ message: "Employee is required" });
    }

    // check duplicate
    const exists = await SalaryStructure.findOne({ employee });
    if (exists) {
      return res.status(400).json({
        message: "Salary structure already exists for this employee",
      });
    }

    const salary = await SalaryStructure.create({
      employee,
      basic,
      hra,
      otherAllowance,
      pf,
      professionalTax,
      tds,
      advance,
      others
    });

    res.status(201).json({
      message: "Salary structure added successfully",
      salary,
    });
  } catch (error) {
    console.error("Add salary error:", error);
    res.status(500).json({
      message: "Failed to add salary structure",
      error: error.message,
    });
  }
};

/**
 * 📋 Get All Salary Structures
 */
export const getAllSalaryStructures = async (req, res) => {
  try {
    const { search, page, limit } = req.query;
    let userIds;

    if (req.user.role === 'Super Admin') {
      // Superadmin can optionally filter by companyId query param
      const { companyId } = req.query;
      if (companyId) {
        const users = await User.find({ companyId }).select("_id");
        userIds = users.map(u => u._id);
      }
    } else {
      // All other roles are strictly scoped to their own company
      if (req.user.companyId) {
        const users = await User.find({ companyId: req.user.companyId }).select("_id");
        userIds = users.map(u => u._id);
      }
    }

    const filter = userIds ? { employee: { $in: userIds } } : {};

    let salaryList = await SalaryStructure.find(filter)
      .populate({
        path: "employee",
        select: "fullName email mobile role employeeId joiningDate designationId departmentId branchId",
        populate: [
          { path: "designationId", select: "name" },
          { path: "departmentId", select: "name" },
          { path: "branchId", select: "name" },
        ],
      })
      .sort({ createdAt: -1 });

    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      salaryList = salaryList.filter(
        (s) => re.test(s.employee?.fullName || '') || re.test(s.employee?.email || '') || re.test(s.employee?.employeeId || '')
      );
    }

    // Pagination is opt-in via `page`.
    if (page) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.max(1, parseInt(limit) || 15);
      const total = salaryList.length;
      const pageItems = salaryList.slice((pageNum - 1) * limitNum, pageNum * limitNum);
      return res.json({
        data: pageItems,
        pagination: { current: pageNum, total: Math.ceil(total / limitNum) || 1, count: total },
      });
    }

    res.json(salaryList);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch salary structures",
      error: error.message,
    });
  }
};

/**
 * 🔍 Get Salary Structure By ID (employee userId)
 * - Employee can only see their own salary structure
 * - HR-Admin / Super Admin can see any
 */
export const getSalaryStructureById = async (req, res) => {
  try {
    const requestedUserId = req.params.id;
    const currentUser = req.user;

    // Ownership check: non-admins can only view their own salary structure
    const isAdmin = currentUser.role === 'Super Admin' || currentUser.role === 'HR-Admin' || currentUser.role === 'Company Admin';
    if (!isAdmin && currentUser._id.toString() !== requestedUserId) {
      return res.status(403).json({ message: "Access denied. You can only view your own salary structure." });
    }

    const salary = await SalaryStructure.find({ employee: requestedUserId }).populate({
      path: "employee",
      select: "fullName email mobile role employeeId joiningDate designationId departmentId branchId",
      populate: [
        { path: "designationId", select: "name" },
        { path: "departmentId", select: "name" },
        { path: "branchId", select: "name" },
      ],
    });
    if (!salary) {
      return res.status(404).json({ message: "Salary structure not found" });
    }

    res.json(salary);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch salary structure",
      error: error.message,
    });
  }
};

/**
 * ✏️ Update Salary Structure
 */
export const updateSalaryStructure = async (req, res) => {
  try {
    const { basic, hra, otherAllowance, pf, professionalTax, tds, advance, others } = req.body;

    const updateData = {};
    if (basic != null) updateData.basic = basic;
    if (hra != null) updateData.hra = hra;
    if (otherAllowance != null) updateData.otherAllowance = otherAllowance;
    if (pf != null) updateData.pf = pf;
    if (professionalTax != null) updateData.professionalTax = professionalTax;
    if (tds != null) updateData.tds = tds;
    if (advance != null) updateData.advance = advance;
    if (others != null) updateData.others = others;

    const salary = await SalaryStructure.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate({
      path: "employee",
      select: "fullName email mobile role employeeId joiningDate designationId departmentId branchId",
      populate: [
        { path: "designationId", select: "name" },
        { path: "departmentId", select: "name" },
        { path: "branchId", select: "name" },
      ],
    });

    if (!salary) {
      return res.status(404).json({ message: "Salary structure not found" });
    }

    res.json({
      message: "Salary structure updated successfully",
      salary,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update salary structure",
      error: error.message,
    });
  }
};

/**
 * 🗑️ Delete Salary Structure
 */
export const deleteSalaryStructureById = async (
  req,
  res
) => {
  try {
    const salary = await SalaryStructure.findByIdAndDelete(req.params.id);

    if (!salary) {
      return res.status(404).json({ message: "Salary structure not found" });
    }

    res.json({
      message: "Salary structure deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to delete salary structure",
      error: error.message,
    });
  }
};
