/** @format */

import { Router } from "express";
import {
  addSalaryStructure,
  getAllSalaryStructures,
  getSalaryStructureById,
  updateSalaryStructure,
  deleteSalaryStructureById,
} from "../controllers/salaryStructureController.js";
import { authMiddleware } from "../middleware/auth.js";
import { checkPermission, checkAnyPermission } from "../middleware/permissions.js";

const SalaryStructureRouter = Router();

// Who may do what (2026-11-11): the same permissions the screens use, because a
// logged-in user could otherwise call these directly.
const can = (feature, action) => checkPermission("hrms", feature, action);
const canAny = (features, action) => checkAnyPermission(features.map((f) => ["hrms", f]), action);

SalaryStructureRouter.use(authMiddleware);

SalaryStructureRouter.post("/", can("salaryStructure", "add"), addSalaryStructure);
SalaryStructureRouter.get("/", canAny(["salaryStructure", "payrollRun"], "view"), getAllSalaryStructures);
SalaryStructureRouter.get("/:id", getSalaryStructureById);
SalaryStructureRouter.put("/:id", can("salaryStructure", "edit"), updateSalaryStructure);
SalaryStructureRouter.delete("/:id", can("salaryStructure", "delete"), deleteSalaryStructureById);

export default SalaryStructureRouter;
