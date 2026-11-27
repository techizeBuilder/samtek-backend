/** @format */
import { Router } from "express";
import { authMiddleware, authorizeRoles } from "../middleware/auth.js";
import { hrRoleSwitch } from "../middleware/permissions.js"; // security re-check M5 (27 Nov 2026): HR needs the HR Policy switch

// Security check day 3 (26 Nov 2026, finding 2): uploading / removing a policy document had no role
// check, so anyone signed in could replace or delete it. Now HR / the Company Admin (the Super Admin
// too), checked BEFORE the upload so a refused file is never saved; the controller checks the company.
const policyEditors = authorizeRoles("HR-Admin", "Hr Admin", "Company Admin", "Super Admin", "Superadmin");
import { hrPolicyUpload } from "../utils/uploadHrPolicy.js";
import {
  getHrPolicies,
  uploadHrPolicyDocument,
  removeHrPolicyDocument,
} from "../controllers/hrPolicyController.js";

const hrPolicyRouter = Router();
hrPolicyRouter.use(authMiddleware);

hrPolicyRouter.get("/", getHrPolicies);
hrPolicyRouter.post(
  "/:policyId/upload",
  policyEditors,
  hrRoleSwitch("hrPolicy", "edit"),
  hrPolicyUpload.single("document"),
  uploadHrPolicyDocument
);
hrPolicyRouter.delete("/:policyId/document", policyEditors, hrRoleSwitch("hrPolicy", "edit"), removeHrPolicyDocument);

export default hrPolicyRouter;
