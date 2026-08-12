/** @format */
import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { userDocumentUpload } from "../utils/uploadUserDocument.js";
import {
  uploadDocument,
  updateDocument,
  getUserDocuments,
  getAllDocuments,
  setDocumentStatus,
} from "../controllers/documentController.js";

const documentRouter = Router();
documentRouter.use(authMiddleware);

// NOTE: /upload/:userId, /update/:docId and /user/:userId are employee
// self-service (own KYC document upload/view — see DocumentUpload.tsx /
// Profile.tsx) and are intentionally left ungated here since regular
// Employee/Manager roles aren't provisioned with the 'hrms' module. Only the
// HR-Admin-only "Document Verification" screens (getAllDocuments,
// setDocumentStatus) are gated below, under the real employeeManagement key.
const employeeManagementView = checkPermission("hrms", "employeeManagement", "view");
const employeeManagementEdit = checkPermission("hrms", "employeeManagement", "edit");

// POST /api/documents/upload/:userId  — first-time upload
documentRouter.post(
  "/upload/:userId",
  userDocumentUpload.any(), // accept any field name (aadhaar / pan / marksheet10 / passbook)
  uploadDocument
);

// PUT /api/documents/update/:docId  — re-upload / update existing doc
documentRouter.put(
  "/update/:docId",
  userDocumentUpload.any(),
  updateDocument
);

// GET /api/documents/user/:userId  — fetch documents for a specific user
documentRouter.get("/user/:userId", getUserDocuments);

// GET /api/documents/all  — fetch all documents (SuperAdmin / Admin)
documentRouter.get("/all", employeeManagementView, getAllDocuments);

// PATCH /api/documents/:docId/status  — HR-Admin verifies/rejects a document
documentRouter.patch("/:docId/status", employeeManagementEdit, setDocumentStatus);

export default documentRouter;
