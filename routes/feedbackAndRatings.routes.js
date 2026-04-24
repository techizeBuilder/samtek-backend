/** @format */

import { Router } from "express";
import { 
  submitManagerFeedback,
  getPendingReviews,
  getMyFeedback,
  getMyAllAppraisalsWithFeedback 
} from "../controllers/FeedbackandRatingsController.js";
import { authMiddleware } from "../middleware/auth.js";

const FeedbackRouter = Router();

/* MANAGER / HR */
FeedbackRouter.post(
  "/",
  authMiddleware,
  submitManagerFeedback
);

FeedbackRouter.get(
  "/pending",
  authMiddleware,
  getPendingReviews
);

/* EMPLOYEE */
FeedbackRouter.get(
  "/my/:selfAppraisalId",
  authMiddleware,
  getMyFeedback
);
FeedbackRouter.get("/my", authMiddleware, getMyAllAppraisalsWithFeedback);

export default FeedbackRouter;
