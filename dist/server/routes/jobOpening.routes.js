"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const jobOpeningController_js_1 = require("../controllers/jobOpeningController.js");
const auth_js_1 = require("../middleware/auth.js");
const jobOpeningUpload_js_1 = require("../utils/jobOpeningUpload.js");
const jobOpeningRoutes = (0, express_1.Router)();
/**
 * 🔐 Protected HRMS Job Opening Routes
 */
jobOpeningRoutes.use(auth_js_1.authMiddleware);
/**
 * Base Route: /api/job-openings
 */
jobOpeningRoutes.post("/", jobOpeningUpload_js_1.uploadJobDocument.single("file"), jobOpeningController_js_1.addJobOpening); // ➕ Add
jobOpeningRoutes.get("/", jobOpeningController_js_1.getAllJobOpenings); // 📋 List
jobOpeningRoutes.get("/:id", jobOpeningController_js_1.getJobOpeningById); // 🔍 Single
jobOpeningRoutes.put("/:id", jobOpeningUpload_js_1.uploadJobDocument.single("file"), jobOpeningController_js_1.updateJobOpening); // ✏️ Update
jobOpeningRoutes.patch("/:id/close", jobOpeningController_js_1.closeJobOpening); // ❌ Close
jobOpeningRoutes.delete("/:id", jobOpeningController_js_1.deleteJobOpeningById); // 🗑️ Delete
exports.default = jobOpeningRoutes;
