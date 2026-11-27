/** @format */

import mongoose from "mongoose";
import Branch from "../models/Branch.js";
import { isSuperAdmin } from "../services/access/companyAccess.js";

// Security check day 2 (26 Nov 2026, docs/security-checks/2026-11-26-company-admin.md): Operating Units
// had no company check at all. The list returned every company's units, and open / edit / delete by id
// reached any company's unit (an edit could even move it to another company; an add could create one in
// another company). Now everything is the caller's own company; the Super Admin keeps every company.
const own = (req) => req.user?.companyId?._id || req.user?.companyId || null;
const scopeOf = (req) => (isSuperAdmin(req.user) ? {} : { companyId: own(req) });
const byId = (req) => (mongoose.isValidObjectId(req.params.id) ? { _id: req.params.id, ...scopeOf(req) } : null);
// Fields a request may set; the company and the creator come from the login, never the request.
const FIELDS = ["name", "code", "city", "state", "country", "address", "pincode", "status"]; // models/Branch.js
const pick = (body = {}) => Object.fromEntries(Object.entries(body).filter(([k]) => FIELDS.includes(k)));

/**
 * CREATE BRANCH
 */
export const createBranch = async (req, res) => {
  try {
    const companyId = isSuperAdmin(req.user) ? req.body?.companyId : own(req);
    if (!companyId) return res.status(400).json({ message: "Company is required" });
    const branch = await Branch.create({
      ...pick(req.body),
      companyId,
      createdBy: req.user?._id || req.user?.id,
    });

    res.status(201).json(branch);
  } catch (error) {
    res.status(400).json({
      message: "Failed to create branch",
      error: error.message,
    });
  }
};

/**
 * GET ALL BRANCHES
 */
export const getAllBranches = async (req, res) => {
  try {
    const filter = { ...scopeOf(req) };
    // The Super Admin may narrow to one company; anyone else always sees their own.
    if (isSuperAdmin(req.user) && req.query.companyId && mongoose.isValidObjectId(req.query.companyId)) filter.companyId = req.query.companyId;
    if (!isSuperAdmin(req.user) && !filter.companyId) return res.json([]);

    const branches = await Branch.find(filter)
      .populate("companyId", "name")
      .sort({ createdAt: -1 });

    const formatted = branches.map((b) => ({
      ...b.toObject(),
      companyName: b.companyId?.name,
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch branches",
      error: error.message,
    });
  }
};

/**
 * GET BRANCH BY ID
 */
export const getBranchById = async (req, res) => {
  try {
    const q = byId(req);
    const branch = q ? await Branch.findOne(q).populate("companyId", "name") : null;

    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    res.json(branch);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch branch",
      error: error.message,
    });
  }
};

/**
 * UPDATE BRANCH
 */
export const updateBranch = async (req, res) => {
  try {
    const q = byId(req);
    const update = pick(req.body);
    // Only the Super Admin moves a unit to another company.
    if (isSuperAdmin(req.user) && req.body?.companyId) update.companyId = req.body.companyId;
    else if (req.body?.companyId && String(req.body.companyId) !== String(own(req))) {
      return res.status(403).json({ message: "A unit can't be moved to another company." });
    }
    const branch = q ? await Branch.findOneAndUpdate(q, update, { new: true, runValidators: true }) : null;

    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    res.json(branch);
  } catch (error) {
    res.status(400).json({
      message: "Failed to update branch",
      error: error.message,
    });
  }
};

/**
 * DELETE BRANCH
 */
export const deleteBranch = async (req, res) => {
  try {
    const q = byId(req);
    const branch = q ? await Branch.findOneAndDelete(q) : null;

    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    res.json({ message: "Branch deleted successfully" });
  } catch (error) {
    res.status(500).json({
      message: "Failed to delete branch",
      error: error.message,
    });
  }
};
