"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const PerformanceController_js_1 = require("../controllers/PerformanceController.js");
const auth_js_1 = require("../middleware/auth.js");
const router = (0, express_1.Router)();
router.use(auth_js_1.authMiddleware);
// GET /api/performance/team-metrics
router.get("/team-metrics", PerformanceController_js_1.getTeamPerformanceMetrics);
exports.default = router;
