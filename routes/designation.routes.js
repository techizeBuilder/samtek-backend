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
import { checkPermission } from "../middleware/permissions.js";

const DesignationRouter = Router();

DesignationRouter.use(authMiddleware);

const designationsView = checkPermission("hrms", "designations", "view");
const designationsAdd = checkPermission("hrms", "designations", "add");
const designationsEdit = checkPermission("hrms", "designations", "edit");
const designationsDelete = checkPermission("hrms", "designations", "delete");

DesignationRouter.post("/", designationsAdd, createDesignation);
DesignationRouter.get("/", designationsView, getDesignations);
DesignationRouter.get("/:id", designationsView, getDesignationById);
DesignationRouter.put("/:id", designationsEdit, updateDesignation);
DesignationRouter.delete("/:id", designationsDelete, deleteDesignation);

export default DesignationRouter;
