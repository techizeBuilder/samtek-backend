"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/** @format */
const express_1 = require("express");
const auth_js_1 = require("../middleware/auth.js");
const uploadHrPolicy_js_1 = require("../utils/uploadHrPolicy.js");
const hrPolicyController_js_1 = require("../controllers/hrPolicyController.js");
const hrPolicyRouter = (0, express_1.Router)();
hrPolicyRouter.use(auth_js_1.authMiddleware);
hrPolicyRouter.get("/", hrPolicyController_js_1.getHrPolicies);
hrPolicyRouter.post("/:policyId/upload", uploadHrPolicy_js_1.hrPolicyUpload.single("document"), hrPolicyController_js_1.uploadHrPolicyDocument);
hrPolicyRouter.delete("/:policyId/document", hrPolicyController_js_1.removeHrPolicyDocument);
exports.default = hrPolicyRouter;
