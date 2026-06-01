"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const designationController_js_1 = require("../controllers/designationController.js");
const auth_js_1 = require("../middleware/auth.js");
const DesignationRouter = (0, express_1.Router)();
DesignationRouter.use(auth_js_1.authenticateToken);
DesignationRouter.post("/", designationController_js_1.createDesignation);
DesignationRouter.get("/", designationController_js_1.getDesignations);
DesignationRouter.get("/:id", designationController_js_1.getDesignationById);
DesignationRouter.put("/:id", designationController_js_1.updateDesignation);
DesignationRouter.delete("/:id", designationController_js_1.deleteDesignation);
exports.default = DesignationRouter;
