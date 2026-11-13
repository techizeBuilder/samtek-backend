/** @format */

import JobOpenings from "../models/JobOpenings.js";
import { companyMatch } from "../utils/companyScope.js";

// Public callers paste these ids from a browser/Postman — a trailing
// newline or space from copy-paste is common and would otherwise reach
// Mongoose as part of the id, crashing the query with a raw CastError
// instead of a clean 400 (found live: 2026-11-12, trailing \n in companyId).
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

/**
 * ➕ Add Job Opening
 */
export const addJobOpening = async (req, res) => {
  try {
    const { jobTitle, department, location, openings, recruitingManager } = req.body;

    if (!jobTitle || !department || !location || !openings) {
      return res.status(400).json({
        message: "Job title, department and location are required",
      });
    }

    const jobData = {
      jobTitle,
      department,
      location,
      openings,
      recruitingManager,
      companyId: req.user.companyId || null,
    };

    if (req.file) {
      jobData.jobDocument = req.file.path.replace(/\\/g, "/");
    }

    const job = await JobOpenings.create(jobData);

    res.status(201).json({
      message: "Job opening added successfully",
      job,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to add job opening",
      error: error.message,
    });
  }
};

/**
 * 📋 Get All Job Openings
 */
export const getAllJobOpenings = async (req, res) => {
  try {
    const { search, page, limit } = req.query;
    const filter = {};

    if (req.user.role === 'Super Admin') {
      // Superadmin can optionally filter by companyId query param
      const { companyId } = req.query;
      if (companyId) filter.companyId = companyId;
    } else {
      // All other roles are strictly scoped to their own company
      if (req.user.companyId) {
        filter.companyId = req.user.companyId;
      }
    }

    if (search) {
      filter.jobTitle = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }

    const query = JobOpenings.find(filter).populate("recruitingManager", "fullName username email").sort({ createdAt: -1 });

    // Pagination is opt-in via `page` — AddJobOpeningModal/ViewEditCandidateModal
    // call this with no params for their dropdown and still need the full array.
    if (page) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.max(1, parseInt(limit) || 15);
      const total = await JobOpenings.countDocuments(filter);
      const jobs = await query.skip((pageNum - 1) * limitNum).limit(limitNum);
      return res.json({
        data: jobs,
        pagination: { current: pageNum, total: Math.ceil(total / limitNum) || 1, count: total },
      });
    }

    const jobs = await query;
    res.json(jobs);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch job openings",
      error: error.message,
    });
  }
};

/**
 * 🌐 Public: List Open Job Openings (no auth — for the company's careers page)
 */
export const getPublicJobOpenings = async (req, res) => {
  try {
    const companyId = (req.query.companyId || "").trim();
    if (!companyId) {
      return res.status(400).json({ success: false, message: "companyId is required" });
    }
    if (!isValidObjectId(companyId)) {
      return res.status(400).json({ success: false, message: "companyId is not a valid id — check for an extra space or line break from copy-paste" });
    }

    const jobs = await JobOpenings.find({ companyId, status: "Open" })
      .select("jobTitle department location openings jobDocument createdAt")
      .sort({ createdAt: -1 });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const data = jobs.map((job) => ({
      jobId: job._id,
      jobTitle: job.jobTitle,
      department: job.department,
      location: job.location,
      openings: job.openings,
      postedOn: job.createdAt,
      jobDocumentUrl: job.jobDocument ? `${baseUrl}/${job.jobDocument}` : null,
    }));

    res.json({ success: true, count: data.length, jobs: data });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch job openings", error: error.message });
  }
};

/**
 * 🌐 Public: Single Job Opening detail (no auth)
 */
export const getPublicJobOpeningById = async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "jobId is not a valid id — check for an extra space or line break from copy-paste" });
    }

    const job = await JobOpenings.findById(id)
      .select("jobTitle department location openings status jobDocument createdAt");

    if (!job) {
      return res.status(404).json({ success: false, message: "Job opening not found" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.json({
      success: true,
      job: {
        jobId: job._id,
        jobTitle: job.jobTitle,
        department: job.department,
        location: job.location,
        openings: job.openings,
        status: job.status,
        postedOn: job.createdAt,
        jobDocumentUrl: job.jobDocument ? `${baseUrl}/${job.jobDocument}` : null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch job opening", error: error.message });
  }
};

/**
 * 🔍 Get Job Opening By ID
 */
export const getJobOpeningById = async (req, res) => {
  try {
    const job = await JobOpenings.findOne({ _id: req.params.id, ...companyMatch(req.user) }).populate("recruitingManager", "fullName username email");

    if (!job) {
      return res.status(404).json({ message: "Job opening not found" });
    }

    res.json(job);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch job opening",
      error: error.message,
    });
  }
};

/**
 * ✏️ Update Job Opening
 */
export const updateJobOpening = async (req, res) => {
  try {
    const { jobTitle, department, location, openings, status, recruitingManager } = req.body;

    const updateData = {};
    if (jobTitle) updateData.jobTitle = jobTitle;
    if (department) updateData.department = department;
    if (location) updateData.location = location;
    if (openings !== undefined) updateData.openings = openings;
    if (status) updateData.status = status;
    if (recruitingManager) updateData.recruitingManager = recruitingManager;

    if (req.file) {
      updateData.jobDocument = req.file.path.replace(/\\/g, "/");
    }

    const job = await JobOpenings.findOneAndUpdate({ _id: req.params.id, ...companyMatch(req.user) }, updateData, {
      new: true,
    });

    if (!job) {
      return res.status(404).json({ message: "Job opening not found" });
    }

    res.json({
      message: "Job opening updated successfully",
      job,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update job opening",
      error: error.message,
    });
  }
};

/**
 * ❌ Close Job Opening
 */
export const closeJobOpening = async (req, res) => {
  try {
    const job = await JobOpenings.findOneAndUpdate(
      { _id: req.params.id, ...companyMatch(req.user) },
      { status: "Closed" },
      { new: true }
    );

    if (!job) {
      return res.status(404).json({ message: "Job opening not found" });
    }

    res.json({
      message: "Job opening closed successfully",
      job,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to close job opening",
      error: error.message,
    });
  }
};

/**
 * 🗑️ Delete Job Opening
 */
export const deleteJobOpeningById = async (req, res) => {
  try {
    const job = await JobOpenings.findOneAndDelete({ _id: req.params.id, ...companyMatch(req.user) });

    if (!job) {
      return res.status(404).json({ message: "Job opening not found" });
    }

    res.json({ message: "Job opening deleted successfully" });
  } catch (error) {
    res.status(500).json({
      message: "Failed to delete job opening",
      error: error.message,
    });
  }
};
