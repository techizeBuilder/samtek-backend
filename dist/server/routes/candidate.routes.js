"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const candidateController_js_1 = require("../controllers/candidateController.js");
const auth_js_1 = require("../middleware/auth.js");
const uploadResume_js_1 = require("../utils/uploadResume.js");
const CandidateRouter = (0, express_1.Router)();
CandidateRouter.use(auth_js_1.authMiddleware);
CandidateRouter.post("/", auth_js_1.authMiddleware, uploadResume_js_1.uploadResume.single("resume"), candidateController_js_1.addCandidate);
CandidateRouter.get("/", auth_js_1.authMiddleware, candidateController_js_1.getAllCandidates);
CandidateRouter.get("/manager/interviews", auth_js_1.authMiddleware, candidateController_js_1.getCandidatesForManager);
CandidateRouter.put("/:id", auth_js_1.authMiddleware, uploadResume_js_1.uploadResume.single("resume"), candidateController_js_1.updateCandidate);
CandidateRouter.patch("/:id/status", auth_js_1.authMiddleware, candidateController_js_1.updateCandidateStatus);
CandidateRouter.patch("/:id/feedback", auth_js_1.authMiddleware, candidateController_js_1.updateInterviewFeedback);
CandidateRouter.delete("/:id", auth_js_1.authMiddleware, candidateController_js_1.deleteCandidate);
exports.default = CandidateRouter;
