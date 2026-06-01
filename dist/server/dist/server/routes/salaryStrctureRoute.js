"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const salaryStructureController_js_1 = require("../controllers/salaryStructureController.js");
const auth_js_1 = require("../middleware/auth.js");
const SalaryStructureRouter = (0, express_1.Router)();
SalaryStructureRouter.use(auth_js_1.authMiddleware);
SalaryStructureRouter.post("/", salaryStructureController_js_1.addSalaryStructure);
SalaryStructureRouter.get("/", salaryStructureController_js_1.getAllSalaryStructures);
SalaryStructureRouter.get("/:id", salaryStructureController_js_1.getSalaryStructureById);
SalaryStructureRouter.put("/:id", salaryStructureController_js_1.updateSalaryStructure);
SalaryStructureRouter.delete("/:id", salaryStructureController_js_1.deleteSalaryStructureById);
exports.default = SalaryStructureRouter;
