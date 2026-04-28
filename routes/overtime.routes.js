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

const OvertimeRouter = Router();

/* Employee Overtime */
OvertimeRouter.post("/", authMiddleware, createOvertime);
OvertimeRouter.get("/me", authMiddleware, getMyOvertimeRequests);
OvertimeRouter.get("/team-requests",authMiddleware,getTeamOvertimeRequests);
OvertimeRouter.patch("/:id", authMiddleware, updateOvertime);
OvertimeRouter.delete("/:id", authMiddleware, deleteOvertime);

export default OvertimeRouter;
