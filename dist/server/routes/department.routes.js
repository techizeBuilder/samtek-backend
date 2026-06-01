"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const departmentController_js_1 = require("../controllers/departmentController.js");
const auth_js_1 = require("../middleware/auth.js");
const DepartmentRouter = (0, express_1.Router)();
DepartmentRouter.use(auth_js_1.authenticateToken);
DepartmentRouter.post("/", departmentController_js_1.createDepartment);
DepartmentRouter.get("/", departmentController_js_1.getDepartments);
DepartmentRouter.get("/:id", departmentController_js_1.getDepartmentById);
DepartmentRouter.put("/:id", departmentController_js_1.updateDepartment);
DepartmentRouter.delete("/:id", departmentController_js_1.deleteDepartment);
exports.default = DepartmentRouter;
