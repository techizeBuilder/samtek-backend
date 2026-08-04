/** @format */

import Candidate from "../models/Candidate.js";
import JobOpening from "../models/JobOpenings.js";

/**
 * ➕ Add Candidate
 */
export const addCandidate = async (req, res) => {
  try {
    const { name, email, mobile, jobId, jobTitle, recruitingManager, hiringDate, joiningDate } = req.body;

    if (!name || !email || !jobId || !jobTitle || !mobile || !req.file) {
      return res.status(400).json({
        message: "Name, Email, Mobile, Job, Title and Resume are required",
      });
    }

    const resumeUrl = `/uploads/resumes/${req.file.filename}`;

    const candidate = await Candidate.create({
      name,
      email,
      jobId,
      jobTitle,
      recruitingManager,
      mobile,
      resumeUrl,
      hiringDate,
      joiningDate,
      companyId: req.user.companyId || null,
    });

    res.status(201).json({
      message: "Candidate added successfully",
      candidate,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to add candidate",
      error: error.message,
    });
  }
};

/**
 * 📋 Get All Candidates
 */
export const getAllCandidates = async (req, res) => {
  try {
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

    const candidates = await Candidate.find(filter)
      .populate({
        path: "jobId",
        populate: {
          path: "recruitingManager",
          select: "fullName username email",
        },
      })
      .sort({ createdAt: -1 });
    res.json(candidates);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch candidates",
      error: error.message,
    });
  }
};

/**
 * 🔄 Update Candidate
 */
export const updateCandidate = async (req, res) => {
  try {
    const { name, email, mobile, jobId, jobTitle, recruitingManager, hiringDate, joiningDate } = req.body;

    const updateData = {
      name,
      email,
      jobId,
      jobTitle,
      recruitingManager,
      mobile,
      hiringDate,
      joiningDate,
    };

    if (req.file) {
      updateData.resumeUrl = `/uploads/resumes/${req.file.filename}`;
    }

    const candidate = await Candidate.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    });

    if (!candidate) {
      return res.status(404).json({ message: "Candidate not found" });
    }

    res.json({ message: "Candidate updated successfully", candidate });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update candidate",
      error: error.message,
    });
  }
};

/**
 * 🔄 Update Status
 */
export const updateCandidateStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const candidate = await Candidate.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!candidate) {
      return res.status(404).json({ message: "Candidate not found" });
    }

    res.json({ message: "Status updated", candidate });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update status",
      error: error.message,
    });
  }
};

/**
 * 🗑️ Delete
 */
export const deleteCandidate = async (req, res) => {
  try {
    const candidate = await Candidate.findByIdAndDelete(req.params.id);
    if (!candidate) {
      return res.status(404).json({ message: "Candidate not found" });
    }
    res.json({ message: "Candidate deleted" });
  } catch (error) {
    res.status(500).json({
      message: "Failed to delete candidate",
      error: error.message,
    });
  }
};

/**
 * 📋 Get Candidates for a specific Manager
 */
export const getCandidatesForManager = async (req, res) => {
  try {
    const managerId = req.user._id;

    // Company-wise scope filter
    const companyFilter = {};
    if (req.user.companyId) {
      companyFilter.companyId = req.user.companyId;
    }

    // 1. Find jobs where this manager is the recruiting manager (within company)
    const jobs = await JobOpening.find({ recruitingManager: managerId, ...companyFilter }).select("_id");
    const jobIds = jobs.map((job) => job._id);

    // 2. Find candidates for these jobs OR directly assigned candidates (within company)
    const candidates = await Candidate.find({
      ...companyFilter,
      $or: [
        { jobId: { $in: jobIds } },
        { recruitingManager: managerId },
      ],
    })
      .populate("jobId")
      .sort({ createdAt: -1 });

    res.json(candidates);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch candidates for manager",
      error: error.message,
    });
  }
};

/**
 * 🔄 Update Interview Rounds & Feedback
 */
export const updateInterviewFeedback = async (req, res) => {
  try {
    const { 
      applied, 
      shortlisted, 
      hrRound, 
      techRound, 
      offer, 
      hired, 
      feedback,
      status 
    } = req.body;

    const candidate = await Candidate.findByIdAndUpdate(
      req.params.id,
      { 
        applied, 
        shortlisted, 
        hrRound, 
        techRound, 
        offer, 
        hired, 
        feedback,
        status
      },
      { new: true }
    );

    if (!candidate) {
      return res.status(404).json({ message: "Candidate not found" });
    }

    res.json({ message: "Interview feedback updated", candidate });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update interview feedback",
      error: error.message,
    });
  }
};
