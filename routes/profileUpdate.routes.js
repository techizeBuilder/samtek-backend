/** @format */

import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { checkPermission, checkAnyPermission } from "../middleware/permissions.js";
// Approving and listing other people's requests needs a permission (2026-11-11).
const can = (feature, action) => checkPermission("hrms", feature, action);
const canAny = (features, action) => checkAnyPermission(features.map((f) => ["hrms", f]), action);
import {
  createProfileUpdate,
  getMyProfileUpdates,
  getTeamProfileUpdateRequests,
  updateProfileUpdate,
} from "../controllers/profileUpdateController.js";

const ProfileUpdateRouter = Router();

ProfileUpdateRouter.use(authMiddleware);

// Employee
ProfileUpdateRouter.post("/", createProfileUpdate);
ProfileUpdateRouter.get("/me", getMyProfileUpdates);

// Manager
ProfileUpdateRouter.get("/manager", can("profileRequests", "view"), getTeamProfileUpdateRequests);
ProfileUpdateRouter.patch("/:id/status", updateProfileUpdate);

export default ProfileUpdateRouter;
