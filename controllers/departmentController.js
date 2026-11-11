/** @format */

import Department from "../models/Department.js";
import Branch from "../models/Branch.js";
import { fixDepartmentBranchIds } from "../scripts/fixDepartmentBranchIds.js";
import { departmentsFromRoles, addDepartmentsFromRoles } from "../services/departmentSeedService.js";

const NO_COMPANY = "Departments from roles work inside one company, and this user has none.";

/* FROM ROLES — the checklist on the Departments page. Always the user's own
   company, whatever the request says. */
export const getDepartmentsFromRoles = async (req, res) => {
  try {
    if (!req.user?.companyId) return res.status(400).json({ message: NO_COMPANY });
    res.json({ success: true, data: await departmentsFromRoles(req.user.companyId) });
  } catch (error) {
    res.status(500).json({ message: "Failed to load departments from roles", error: error.message });
  }
};

export const postDepartmentsFromRoles = async (req, res) => {
  try {
    if (!req.user?.companyId) return res.status(400).json({ message: NO_COMPANY });
    const added = await addDepartmentsFromRoles(req.user.companyId, req.body?.names);
    res.status(201).json({ success: true, added });
  } catch (error) {
    res.status(400).json({ message: "Failed to add departments", error: error.message });
  }
};

/* CREATE */
export const createDepartment = async (req, res) => {
  try {
    const data = { ...req.body };

    // Non-SuperAdmin can only create departments for their own company
    if (req.user && req.user.role !== 'Super Admin') {
      if (req.user.companyId) {
        data.companyId = req.user.companyId;
      }
    }

    const department = await Department.create(data);
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
  const { branchId, companyId, search, page, limit } = req.query;
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

  if (branchId) filter.branchId = branchId;

  if (search) {
    filter.name = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  const query = Department.find(filter)
    .populate("companyId", "name unitName")
    .populate("branchId", "name")
    .populate("headEmployeeId", "fullName name email")
    .sort({ createdAt: -1 });

  // Pagination is opt-in via `page` — dropdown consumers (CostCenterModal,
  // DesignationModal) call this with no params and still need the full
  // plain array back.
  if (page) {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, parseInt(limit) || 15);
    const total = await Department.countDocuments(filter);
    const departments = await query.skip((pageNum - 1) * limitNum).limit(limitNum);
    return res.json({
      success: true,
      data: departments,
      pagination: { current: pageNum, total: Math.ceil(total / limitNum) || 1, count: total },
    });
  }

  const departments = await query;
  res.json(departments);
};

/* GET BY ID */
export const getDepartmentById = async (req, res) => {
  const department = await Department.findById(req.params.id)
    .populate("companyId", "name unitName")
    .populate("branchId", "name")
    .populate("headEmployeeId", "fullName name email");

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

/* ONE-TIME MIGRATION: Fix departments with wrong branchId */
export const migrateDepartmentBranchIds = async (req, res) => {
  try {
    // Only Super Admin can run this
    if (req.user?.role !== "Super Admin") {
      return res.status(403).json({ message: "Access denied. Super Admin only." });
    }

    const results = await fixDepartmentBranchIds();
    res.json({
      message: "Migration complete",
      results,
    });
  } catch (err) {
    res.status(500).json({ message: "Migration failed", error: err.message });
  }
};