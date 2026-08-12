/** @format */

import { Router } from "express";
import {
  createBranch,
  getAllBranches,
  getBranchById,
  updateBranch,
  deleteBranch,
} from "../controllers/branchController.js";
import { authenticateToken as authMiddleware } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const BranchRouter = Router();

BranchRouter.use(authMiddleware); // JWT protect

const operatingUnitsView = checkPermission("hrms", "operatingUnits", "view");
const operatingUnitsAdd = checkPermission("hrms", "operatingUnits", "add");
const operatingUnitsEdit = checkPermission("hrms", "operatingUnits", "edit");
const operatingUnitsDelete = checkPermission("hrms", "operatingUnits", "delete");

BranchRouter.post("/", operatingUnitsAdd, createBranch);
BranchRouter.get("/", operatingUnitsView, getAllBranches);
BranchRouter.get("/:id", operatingUnitsView, getBranchById);
BranchRouter.put("/:id", operatingUnitsEdit, updateBranch);
BranchRouter.delete("/:id", operatingUnitsDelete, deleteBranch);

export default BranchRouter;