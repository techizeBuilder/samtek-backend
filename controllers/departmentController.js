/** @format */

import Department from "../models/Department.js";

/* CREATE */
export const createDepartment = async (req, res) => {
  try {
    const department = await Department.create(req.body);
    res.status(201).json(department);
  } catch (error) {
    res.status(400).json({
      message: "Failed to create department",
      error: error.message,
    });
  }
};

/* GET ALL */
export const getDepartments = async (req, res) => {
  const { branchId, companyId } = req.query;
  const filter = {};
  
  // Role-based filtering for Company Admin / Unit Head / etc.
  if (req.user && req.user.role !== 'Super Admin' && req.user.role !== 'HR-Admin') {
    if (req.user.companyId) {
      filter.companyId = req.user.companyId;
    }
  }

  if (branchId) filter.branchId = branchId;
  if (companyId) filter.companyId = companyId;

  const departments = await Department.find(filter)
    .populate("companyId", "name")
    .populate("branchId", "name")
    .populate("headEmployeeId", "name email");

  res.json(departments);
};

/* GET BY ID */
export const getDepartmentById = async (req, res) => {
  const department = await Department.findById(req.params.id)
    .populate("companyId", "name")
    .populate("branchId", "name")
    .populate("headEmployeeId", "name email");

  if (!department) {
    return res.status(404).json({ message: "Department not found" });
  }

  res.json(department);
};

/* UPDATE */
export const updateDepartment = async (req, res) => {
  const department = await Department.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true }
  );

  res.json(department);
};

/* DELETE */
export const deleteDepartment = async (req, res) => {
  await Department.findByIdAndDelete(req.params.id);
  res.json({ message: "Department deleted" });
};