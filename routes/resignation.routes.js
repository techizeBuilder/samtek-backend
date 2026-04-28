/** @format */

import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  createResignation,
  getMyResignations,
  updateResignation,
  deleteResignation,
  getAllResignations,
  getTeamResignations,
  updateResignationStatus,
} from "../controllers/resignationController.js";

const ResignationRouter = Router();

ResignationRouter.use(authMiddleware);

// Employee
ResignationRouter.post("/", createResignation);
ResignationRouter.get("/", getMyResignations); // Front-end calls GET /resignation
ResignationRouter.patch("/:id", updateResignation);
ResignationRouter.delete("/:id", deleteResignation);

// Manager
ResignationRouter.get("/manager", getTeamResignations);

// Admin
ResignationRouter.get("/all", getAllResignations);
ResignationRouter.patch("/:id/status", updateResignationStatus);

export default ResignationRouter;
