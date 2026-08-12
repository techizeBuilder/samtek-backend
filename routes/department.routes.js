/** @format */

import { Router } from "express";
import {
  createDepartment,
  getDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
  migrateDepartmentBranchIds,
} from "../controllers/departmentController.js";
import { authenticateToken as authMiddleware } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const DepartmentRouter = Router();

DepartmentRouter.use(authMiddleware);

const departmentsView = checkPermission("hrms", "departments", "view");
const departmentsAdd = checkPermission("hrms", "departments", "add");
const departmentsEdit = checkPermission("hrms", "departments", "edit");
const departmentsDelete = checkPermission("hrms", "departments", "delete");

DepartmentRouter.post("/", departmentsAdd, createDepartment);
DepartmentRouter.get("/", departmentsView, getDepartments);
DepartmentRouter.get("/migrate/fix-branch-ids", departmentsEdit, migrateDepartmentBranchIds);
DepartmentRouter.get("/:id", departmentsView, getDepartmentById);
DepartmentRouter.put("/:id", departmentsEdit, updateDepartment);
DepartmentRouter.delete("/:id", departmentsDelete, deleteDepartment);

export default DepartmentRouter;