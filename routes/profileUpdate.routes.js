/** @format */

import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
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
ProfileUpdateRouter.get("/manager", getTeamProfileUpdateRequests);
ProfileUpdateRouter.patch("/:id/status", updateProfileUpdate);

export default ProfileUpdateRouter;
