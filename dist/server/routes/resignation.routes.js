"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_js_1 = require("../middleware/auth.js");
const resignationController_js_1 = require("../controllers/resignationController.js");
const ResignationRouter = (0, express_1.Router)();
ResignationRouter.use(auth_js_1.authMiddleware);
// Employee
ResignationRouter.post("/", resignationController_js_1.createResignation);
ResignationRouter.get("/", resignationController_js_1.getMyResignations); // Front-end calls GET /resignation
ResignationRouter.patch("/:id", resignationController_js_1.updateResignation);
ResignationRouter.delete("/:id", resignationController_js_1.deleteResignation);
// Manager
ResignationRouter.get("/manager", resignationController_js_1.getTeamResignations);
// Admin
ResignationRouter.get("/all", resignationController_js_1.getAllResignations);
ResignationRouter.patch("/:id/status", resignationController_js_1.updateResignationStatus);
exports.default = ResignationRouter;
