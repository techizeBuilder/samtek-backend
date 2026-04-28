/** @format */

import { Router } from "express";
import {
  createDesignation,
  getDesignations,
  getDesignationById,
  updateDesignation,
  deleteDesignation,
} from "../controllers/designationController.js";
import { authenticateToken as authMiddleware } from "../middleware/auth.js";

const DesignationRouter = Router();

DesignationRouter.use(authMiddleware);

DesignationRouter.post("/", createDesignation);
DesignationRouter.get("/", getDesignations);
DesignationRouter.get("/:id", getDesignationById);
DesignationRouter.put("/:id", updateDesignation);
DesignationRouter.delete("/:id", deleteDesignation);

export default DesignationRouter;
