/** @format */

import { Router } from "express";
import {
  addJobOpening,
  getAllJobOpenings,
  getJobOpeningById,
  updateJobOpening,
  closeJobOpening,
  deleteJobOpeningById,
  getPublicJobOpenings,
  getPublicJobOpeningById,
} from "../controllers/jobOpeningController.js";
import { authMiddleware } from "../middleware/auth.js";
import { uploadJobDocument } from "../utils/jobOpeningUpload.js";
import { checkPermission, checkAnyPermission } from "../middleware/permissions.js";

const jobOpeningRoutes = Router();

// Who may do what (2026-11-11): the same permissions the screens use, because a
// logged-in user could otherwise call these directly.
const can = (feature, action) => checkPermission("hrms", feature, action);
const canAny = (features, action) => checkAnyPermission(features.map((f) => ["hrms", f]), action);

/**
 * 🌐 Public Careers-Page Routes (No Auth — called by the company website)
 * Base Route: /api/job-openings
 */
jobOpeningRoutes.get("/public", getPublicJobOpenings);       // GET /api/job-openings/public?companyId=...
jobOpeningRoutes.get("/public/:id", getPublicJobOpeningById); // GET /api/job-openings/public/:id

/**
 * 🔐 Protected HRMS Job Opening Routes
 */
jobOpeningRoutes.use(authMiddleware);

/**
 * Base Route: /api/job-openings
 */
jobOpeningRoutes.post("/", can("jobOpenings", "add"), uploadJobDocument.single("file"), addJobOpening); // ➕ Add
jobOpeningRoutes.get("/", canAny(["jobOpenings", "candidates", "interviewPipeline"], "view"), getAllJobOpenings); // 📋 List
jobOpeningRoutes.get("/:id", canAny(["jobOpenings", "candidates", "interviewPipeline"], "view"), getJobOpeningById); // 🔍 Single
jobOpeningRoutes.put("/:id", can("jobOpenings", "edit"), uploadJobDocument.single("file"), updateJobOpening); // ✏️ Update
jobOpeningRoutes.patch("/:id/close", can("jobOpenings", "edit"), closeJobOpening); // ❌ Close
jobOpeningRoutes.delete("/:id", can("jobOpenings", "delete"), deleteJobOpeningById); // 🗑️ Delete

export default jobOpeningRoutes;
