/** @format */

import { Router } from "express";
import { getTeamPerformanceMetrics } from "../controllers/PerformanceController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

router.use(authMiddleware);

// GET /api/performance/team-metrics
router.get("/team-metrics", getTeamPerformanceMetrics);

export default router;
