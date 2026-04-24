/** @format */

import { Router } from "express";
import {
  addJobOpening,
  getAllJobOpenings,
  getJobOpeningById,
  updateJobOpening,
  closeJobOpening,
  deleteJobOpeningById,
} from "../controllers/jobOpeningController.js";
import { authMiddleware } from "../middleware/auth.js";
import { uploadJobDocument } from "../utils/jobOpeningUpload.js";

const jobOpeningRoutes = Router();

/**
 * 🔐 Protected HRMS Job Opening Routes
 */
jobOpeningRoutes.use(authMiddleware);

/**
 * Base Route: /api/job-openings
 */
jobOpeningRoutes.post("/", uploadJobDocument.single("file"), addJobOpening); // ➕ Add
jobOpeningRoutes.get("/", getAllJobOpenings); // 📋 List
jobOpeningRoutes.get("/:id", getJobOpeningById); // 🔍 Single
jobOpeningRoutes.put("/:id", uploadJobDocument.single("file"), updateJobOpening); // ✏️ Update
jobOpeningRoutes.patch("/:id/close", closeJobOpening); // ❌ Close
jobOpeningRoutes.delete("/:id", deleteJobOpeningById); // 🗑️ Delete

export default jobOpeningRoutes;
