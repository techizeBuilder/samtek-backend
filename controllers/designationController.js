/** @format */

import Designation from "../models/Designation.js";

export const createDesignation = async (req, res) => {
  try {
    const data = { ...req.body };
    if (data.departmentId === "") {
      data.departmentId = null;
    }

    // Non-SuperAdmin can only create designations for their own company
    if (req.user && req.user.role !== 'Super Admin') {
      if (req.user.companyId) {
        data.companyId = req.user.companyId;
      }
    }

    const designation = await Designation.create(data);
    res.status(201).json(designation);
  } catch (err) {
    res.status(400).json({ message: "Create failed", error: err.message });
  }
};

export const getDesignations = async (req, res) => {
  const { companyId, departmentId } = req.query;

  const filter = {};

  if (req.user && req.user.role === 'Super Admin') {
    // Superadmin can optionally filter by companyId query param
    if (companyId) filter.companyId = companyId;
  } else {
    // All other roles are strictly scoped to their own company
    if (req.user && req.user.companyId) {
      filter.companyId = req.user.companyId;
    }
  }

  if (departmentId) filter.departmentId = departmentId;

  const data = await Designation.find(filter)
    .populate("companyId", "name")
    .populate("departmentId", "name")
    .sort({ createdAt: -1 });

  res.json(data);
};

export const getDesignationById = async (req, res) => {
  const data = await Designation.findById(req.params.id)
    .populate("companyId", "name")
    .populate("departmentId", "name");

  res.json(data);
};

export const updateDesignation = async (req, res) => {
  try {
    const data = { ...req.body };
    if (data.departmentId === "") {
      data.departmentId = null;
    }
    const updated = await Designation.findByIdAndUpdate(
      req.params.id,
      data,
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: "Update failed", error: err.message });
  }
};

export const deleteDesignation = async (req, res) => {
  await Designation.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted successfully" });
};