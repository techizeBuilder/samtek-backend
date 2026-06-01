"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const FeedbackandRatingsController_js_1 = require("../controllers/FeedbackandRatingsController.js");
const auth_js_1 = require("../middleware/auth.js");
const FeedbackRouter = (0, express_1.Router)();
/* MANAGER / HR */
FeedbackRouter.post("/", auth_js_1.authMiddleware, FeedbackandRatingsController_js_1.submitManagerFeedback);
FeedbackRouter.get("/pending", auth_js_1.authMiddleware, FeedbackandRatingsController_js_1.getPendingReviews);
/* EMPLOYEE */
FeedbackRouter.get("/my/:selfAppraisalId", auth_js_1.authMiddleware, FeedbackandRatingsController_js_1.getMyFeedback);
FeedbackRouter.get("/my", auth_js_1.authMiddleware, FeedbackandRatingsController_js_1.getMyAllAppraisalsWithFeedback);
exports.default = FeedbackRouter;
