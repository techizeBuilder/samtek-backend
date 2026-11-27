/** @format */

import { Router } from "express";
import {
  createDepartment,
  getDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
  migrateDepartmentBranchIds,
  getDepartmentsFromRoles,
  postDepartmentsFromRoles,
} from "../controllers/departmentController.js";
import { authenticateToken as authMiddleware } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
// Feature 29 (24 Nov 2026): the Company Admin sets departments; others (HR) only see the list.
import { canManageDepartments } from "../services/access/companyAccess.js";

const DepartmentRouter = Router();

DepartmentRouter.use(authMiddleware);

const departmentsView = checkPermission("hrms", "departments", "view");
const departmentsAdd = checkPermission("hrms", "departments", "add");
const departmentsEdit = checkPermission("hrms", "departments", "edit");
const departmentsDelete = checkPermission("hrms", "departments", "delete");
const departmentOwner = (req, res, next) => (canManageDepartments(req.user) ? next()
  : res.status(403).json({ success: false, message: "Departments are set by the Company Admin." }));

DepartmentRouter.post("/", departmentOwner, departmentsAdd, createDepartment);
DepartmentRouter.get("/", departmentsView, getDepartments);
DepartmentRouter.get("/migrate/fix-branch-ids", departmentOwner, departmentsEdit, migrateDepartmentBranchIds);
DepartmentRouter.get("/from-roles", departmentsView, getDepartmentsFromRoles);
DepartmentRouter.post("/from-roles", departmentOwner, departmentsAdd, postDepartmentsFromRoles);
DepartmentRouter.get("/:id", departmentsView, getDepartmentById);
DepartmentRouter.put("/:id", departmentOwner, departmentsEdit, updateDepartment);
DepartmentRouter.delete("/:id", departmentOwner, departmentsDelete, deleteDepartment);

export default DepartmentRouter;