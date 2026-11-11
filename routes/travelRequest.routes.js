/** @format */

import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  createTravelRequest,
  getMyTravelRequests,
  getManagerTravelRequests,
  updateManagerTravelStatus,
  getAllTravelRequests,
  updateTravelRequest,
  deleteTravelRequest,
  uploadTravelReceipt,
} from "../controllers/travelRequestController.js";
import { travelUpload } from "../utils/travelUpload.js";
import { authorizeRoles } from "../middleware/auth.js";
import { checkPermission, checkAnyPermission } from "../middleware/permissions.js";
// Approving and listing other people's requests needs a permission (2026-11-11).
const can = (feature, action) => checkPermission("hrms", feature, action);
const canAny = (features, action) => checkAnyPermission(features.map((f) => ["hrms", f]), action);

const TravelRequestRouter = Router();

TravelRequestRouter.use(authMiddleware);

// Employee
TravelRequestRouter.post("/", travelUpload.single("receipt"), createTravelRequest);
TravelRequestRouter.get("/me", getMyTravelRequests);
TravelRequestRouter.put("/:id", travelUpload.single("receipt"), updateTravelRequest);
TravelRequestRouter.delete("/:id", deleteTravelRequest);
TravelRequestRouter.post("/:id/receipt", travelUpload.single("receipt"), uploadTravelReceipt);

// Manager
TravelRequestRouter.get("/manager", can("travelRequests", "view"), getManagerTravelRequests);
TravelRequestRouter.patch("/:id/status", can("travelRequests", "edit"), updateManagerTravelStatus);

// Admin/HR
TravelRequestRouter.get("/all", authorizeRoles("HR-Admin", "Hr Admin", "Company Admin", "Superadmin", "Super Admin"), getAllTravelRequests);

export default TravelRequestRouter;
