/** @format */

import { Router } from "express";
import {
  addCandidate,
  getAllCandidates,
  updateCandidate,
  updateCandidateStatus,
  deleteCandidate,
  getCandidatesForManager,
  updateInterviewFeedback,
} from "../controllers/candidateController.js";
import { authMiddleware } from "../middleware/auth.js";
import { uploadResume } from "../utils/uploadResume.js";
import { checkPermission, checkAnyPermission } from "../middleware/permissions.js";

const CandidateRouter = Router();

// Who may do what (2026-11-11): the same permissions the screens use, because a
// logged-in user could otherwise call these directly.
const can = (feature, action) => checkPermission("hrms", feature, action);
const canAny = (features, action) => checkAnyPermission(features.map((f) => ["hrms", f]), action);

CandidateRouter.use(authMiddleware);
CandidateRouter.post("/", authMiddleware, can("candidates", "add"), uploadResume.single("resume"), addCandidate);
CandidateRouter.get("/", authMiddleware, canAny(["candidates", "interviewPipeline"], "view"), getAllCandidates);
CandidateRouter.get("/manager/interviews", authMiddleware, canAny(["interviewFeedback", "interviewPipeline"], "view"), getCandidatesForManager);
CandidateRouter.put(
  "/:id",
  authMiddleware,
  can("candidates", "edit"),
  uploadResume.single("resume"),
  updateCandidate
);
CandidateRouter.patch("/:id/status", authMiddleware, canAny(["candidates", "interviewPipeline"], "edit"), updateCandidateStatus);
CandidateRouter.patch("/:id/feedback", authMiddleware, canAny(["interviewFeedback", "interviewPipeline", "candidates"], "edit"), updateInterviewFeedback);
CandidateRouter.delete("/:id", authMiddleware, can("candidates", "delete"), deleteCandidate);

export default CandidateRouter;
