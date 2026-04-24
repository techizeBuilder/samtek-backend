/** @format */
import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
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
  hrPolicyUpload.single("document"),
  uploadHrPolicyDocument
);
hrPolicyRouter.delete("/:policyId/document", removeHrPolicyDocument);

export default hrPolicyRouter;
