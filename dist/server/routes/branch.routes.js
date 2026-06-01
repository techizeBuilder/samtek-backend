"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const branchController_js_1 = require("../controllers/branchController.js");
const auth_js_1 = require("../middleware/auth.js");
const BranchRouter = (0, express_1.Router)();
BranchRouter.use(auth_js_1.authenticateToken); // JWT protect
BranchRouter.post("/", branchController_js_1.createBranch);
BranchRouter.get("/", branchController_js_1.getAllBranches);
BranchRouter.get("/:id", branchController_js_1.getBranchById);
BranchRouter.put("/:id", branchController_js_1.updateBranch);
BranchRouter.delete("/:id", branchController_js_1.deleteBranch);
exports.default = BranchRouter;
