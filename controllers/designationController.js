/** @format */

import Designation from "../models/Designation.js";
// Feature 29 (24 Nov 2026): by id, only the caller's own company's designations (a Super Admin: any).
import mongoose from "mongoose";
import { isSuperAdmin } from "../services/access/companyAccess.js";
const ownOne = (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  const cid = req.user?.companyId?._id || req.user?.companyId;
  return isSuperAdmin(req.user) ? { _id: req.params.id } : { _id: req.params.id, companyId: { $in: [cid, String(cid)] } };
};

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
  const { companyId, departmentId, search, page, limit } = req.query;

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

  if (search) {
    filter.name = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  const query = Designation.find(filter)
    .populate("companyId", "name")
    .populate("departmentId", "name")
    .sort({ createdAt: -1 });

  // Pagination is opt-in via `page` — dropdown consumers (DesignationModal's
  // department picker etc.) call this with no params and still need the
  // full plain array back.
  if (page) {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, parseInt(limit) || 15);
    const total = await Designation.countDocuments(filter);
    const data = await query.skip((pageNum - 1) * limitNum).limit(limitNum);
    return res.json({
      success: true,
      data,
      pagination: { current: pageNum, total: Math.ceil(total / limitNum) || 1, count: total },
    });
  }

  const data = await query;
  res.json(data);
};

export const getDesignationById = async (req, res) => {
  const q = ownOne(req);
  const data = q ? await Designation.findOne(q)
    .populate("companyId", "name")
    .populate("departmentId", "name") : null;
  if (!data) return res.status(404).json({ message: "Designation not found" });
  res.json(data);
};

export const updateDesignation = async (req, res) => {
  try {
    const q = ownOne(req);
    // The company never changes in an edit (feature 29).
    const { companyId, _id, ...data } = req.body || {};
    if (data.departmentId === "") {
      data.departmentId = null;
    }
    const updated = q ? await Designation.findOneAndUpdate(q, data, { new: true }) : null;
    if (!updated) return res.status(404).json({ message: "Designation not found" });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: "Update failed", error: err.message });
  }
};

export const deleteDesignation = async (req, res) => {
  const q = ownOne(req);
  const gone = q ? await Designation.findOneAndDelete(q) : null;
  if (!gone) return res.status(404).json({ message: "Designation not found" });
  res.json({ message: "Deleted successfully" });
};