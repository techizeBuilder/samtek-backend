/** @format */

import { Router } from "express";
import {
  createDepartment,
  getDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
} from "../controllers/departmentController.js";
import { authenticateToken as authMiddleware } from "../middleware/auth.js";

const DepartmentRouter = Router();

DepartmentRouter.use(authMiddleware);

DepartmentRouter.post("/", createDepartment);
DepartmentRouter.get("/", getDepartments);
DepartmentRouter.get("/:id", getDepartmentById);
DepartmentRouter.put("/:id", updateDepartment);
DepartmentRouter.delete("/:id", deleteDepartment);

export default DepartmentRouter;