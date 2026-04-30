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

const BranchRouter = Router();

BranchRouter.use(authMiddleware); // JWT protect

BranchRouter.post("/", createBranch);
BranchRouter.get("/", getAllBranches);
BranchRouter.get("/:id", getBranchById);
BranchRouter.put("/:id", updateBranch);
BranchRouter.delete("/:id", deleteBranch);

export default BranchRouter;