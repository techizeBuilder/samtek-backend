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
    const { companyId } = req.query;
    let filter = {};

    if (companyId) {
      const users = await User.find({ companyId }).select("_id");
      filter.employee = { $in: users.map(u => u._id) };
    }

    const salaryList = await SalaryStructure.find(filter)
      .populate({
        path: "employee",
        populate: [
          { path: "designationId" },
          { path: "departmentId" },
          { path: "branchId" }
        ]
      })
      .sort({ createdAt: -1 });

    res.json(salaryList);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch salary structures",
      error: error.message,
    });
  }
};

/**
 * 🔍 Get Salary Structure By ID
 */
export const getSalaryStructureById = async (req, res) => {
  try {
    const salary = await SalaryStructure.find({ employee: req.params.id }).populate({
      path: "employee",
      populate: [
        { path: "designationId" },
        { path: "departmentId" },
        { path: "branchId" }
      ]
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
      select: "name employeeId joiningDate designationId departmentId branchId",
      populate: [
        { path: "designationId", select: "name" },
        { path: "departmentId", select: "name" },
        { path: "branchId", select: "name" }
      ]
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
