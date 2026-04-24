/** @format */

import FeedbackandRatings from "../models/FeedbackandRatings.js";
import SelfAppraisal from "../../models/hrms/SelfAppraisal.js"; // Keeping path as is but adding .js

export const submitManagerFeedback = async (req, res) => {
  try {
    const reviewerId = req.user.id;

    const { selfAppraisalId, managerRatings, feedback, recommendation } =
      req.body;

    const selfAppraisal = await SelfAppraisal.findById(selfAppraisalId);

    if (!selfAppraisal)
      return res.status(404).json({ message: "Self appraisal not found" });

    if (selfAppraisal.status !== "SUBMITTED")
      return res
        .status(400)
        .json({ message: "Self appraisal not submitted yet" });

    const already = await FeedbackandRatings.findOne({
      selfAppraisalId,
    });

    if (already) return res.status(400).json({ message: "Already reviewed" });

    const review = await FeedbackandRatings.create({
      selfAppraisalId,
      employeeId: selfAppraisal.employeeId,
      reviewerId,
      managerRatings,
      feedback,
      recommendation,
    });

    res.json(review);
  } catch (err) {
    res.status(500).json({ message: "Failed to submit feedback" });
  }
};
export const getPendingReviews = async (req, res) => {
  const managerId = req.user.id;

  const selfAppraisals = await SelfAppraisal.find({
    status: "SUBMITTED",
  })
    .populate({
      path: "employeeId",
      select: "name department managerId",
      match: { managerId },
    })
    .populate("appraisalId", "title type");

  const filtered = selfAppraisals.filter((s) => s.employeeId);

  const reviews = await FeedbackandRatings.find({
    selfAppraisalId: { $in: filtered.map((s) => s._id) },
  });

  const reviewedMap = new Map(
    reviews.map((r) => [r.selfAppraisalId.toString(), true])
  );

  const response = filtered.map((s) => ({
    selfAppraisalId: s._id,

    employee: s.employeeId,
    appraisal: s.appraisalId,

    // ✅ EMPLOYEE SELF DATA
    goalsAchievement: s.goalsAchievement,
    goalsRating: s.goalsRating,

    skillsRating: s.skillsRating,

    contributions: s.contributions,
    challenges: s.challenges,
    learning: s.learning,
    summary: s.summary,

    submittedAt: s.createdAt,

    status: reviewedMap.has(s._id.toString()) ? "REVIEWED" : "PENDING",
  }));

  res.json(response);
};

export const getMyFeedback = async (req, res) => {
  const selfAppraisalId = req.params.selfAppraisalId;

  const feedback = await FeedbackandRatings.findOne({
    selfAppraisalId,
  })
    .populate("reviewerId", "name")
    .populate({
      path: "selfAppraisalId",
      populate: { path: "appraisalId", select: "title type" },
    });

  if (!feedback) {
    return res.status(404).json({ message: "Feedback not available yet" });
  }

  res.json(feedback);
};

export const getMyAllAppraisalsWithFeedback = async (
  req,
  res
) => {
  try {
    const employeeId = req.user.id;

    // 1️⃣ Employee ke saare self appraisals
    const selfAppraisals = await SelfAppraisal.find({
      employeeId,
    }).populate("appraisalId", "title type");

    if (!selfAppraisals.length) {
      return res.json([]);
    }

    // 2️⃣ Unke feedback (manager/HR)
    const feedbackDocs = await FeedbackandRatings.find({
      employeeId,
    }).populate("reviewerId", "name");

    // 3️⃣ Map for quick lookup (selfAppraisalId -> feedback)
    const feedbackMap = new Map(
      feedbackDocs.map((f) => [f.selfAppraisalId.toString(), f])
    );

    // 4️⃣ Final response
    const response = selfAppraisals.map((s) => {
    const feedbackDoc = feedbackMap.get(s._id.toString());

    const feedback = feedbackDoc ? feedbackDoc.toObject() : null;

      return {
        selfAppraisalId: s._id,

        appraisal: s.appraisalId,

        submittedAt: s.createdAt,

        status: feedback ? "REVIEWED" : "PENDING",

        // 🧑‍💼 EMPLOYEE SELF RATINGS
        selfRatings: {
          goalsRating: s.goalsRating,
          skillsRating: s.skillsRating,
          summary: s.summary,
        },

        // 👨‍💼 MANAGER / HR FEEDBACK
        managerFeedback: feedback
          ? {
              reviewer: feedback.reviewerId,
              managerRatings: feedback.managerRatings,
              feedback: feedback.feedback,
              recommendation: feedback.recommendation,
              overallRating: feedback.managerRatings.overall,
              reviewedAt: feedback.createdAt,
            }
          : null,
      };
    });

    res.json(response);
  } catch (err) {
    res.status(500).json({ message: "Failed to load appraisal history" });
  }
};
