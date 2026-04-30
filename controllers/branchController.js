/** @format */

import Branch from "../models/Branch";

/**
 * CREATE BRANCH
 */
export const createBranch = async (req, res) => {
  try {
    const branch = await Branch.create({
      ...req.body,
      createdBy: req.user?.id, // JWT middleware se
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
    const { companyId } = req.query;
    const filter = {};
    if (companyId) filter.companyId = companyId;

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
    const branch = await Branch.findById(req.params.id).populate(
      "companyId",
      "name"
    );

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
    const branch = await Branch.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });

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
    const branch = await Branch.findByIdAndDelete(req.params.id);

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