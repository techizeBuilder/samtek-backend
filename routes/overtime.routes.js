/** @format */

import { Router } from "express";
import {
  createOvertime,
  getMyOvertimeRequests,
  updateOvertime,
  deleteOvertime,
  getTeamOvertimeRequests,
} from "../controllers/overtimeController.js";
import { authMiddleware } from "../middleware/auth.js";
import { checkPermission, checkAnyPermission } from "../middleware/permissions.js";
// Approving and listing other people's requests needs a permission (2026-11-11).
const can = (feature, action) => checkPermission("hrms", feature, action);
const canAny = (features, action) => checkAnyPermission(features.map((f) => ["hrms", f]), action);

const OvertimeRouter = Router();

/* Employee Overtime */
OvertimeRouter.post("/", authMiddleware, createOvertime);
OvertimeRouter.get("/me", authMiddleware, getMyOvertimeRequests);
OvertimeRouter.get("/team-requests", authMiddleware, can("overtimeRequests", "view"), getTeamOvertimeRequests);
OvertimeRouter.patch("/:id", authMiddleware, updateOvertime);
OvertimeRouter.delete("/:id", authMiddleware, deleteOvertime);

export default OvertimeRouter;
