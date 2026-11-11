/** @format */

import { Router } from "express";
import { authMiddleware, authorizeRoles } from "../middleware/auth.js";

// Resignations are decided by the person's Manager or HR (2026-11-11).
const managerOrHr = authorizeRoles("Manager", "HR-Admin", "Hr Admin", "Company Admin", "Superadmin", "Super Admin");
const hrOnly = authorizeRoles("HR-Admin", "Hr Admin", "Company Admin", "Superadmin", "Super Admin");
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
ResignationRouter.get("/manager", managerOrHr, getTeamResignations);

// Admin
ResignationRouter.get("/all", hrOnly, getAllResignations);
ResignationRouter.patch("/:id/status", managerOrHr, updateResignationStatus);

export default ResignationRouter;
