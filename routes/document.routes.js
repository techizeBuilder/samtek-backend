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
  getDocumentFile,
  guardUserDocuments,
  guardDocument,
} from "../controllers/documentController.js";

const documentRouter = Router();
documentRouter.use(authMiddleware);

// /upload/:userId, /update/:docId, /user/:userId and /file/:docId are for the
// person themselves or HR (and to view, their Manager): see
// services/documentAccessService.js. They can't use checkPermission alone, because
// regular Employee/Manager roles aren't provisioned with the 'hrms' module. The
// guard runs before the file is saved. The HR-Admin-only "Document Verification"
// screens (getAllDocuments, setDocumentStatus) are gated below, under the real
// employeeManagement key.
const employeeManagementView = checkPermission("hrms", "employeeManagement", "view");
const employeeManagementEdit = checkPermission("hrms", "employeeManagement", "edit");

// POST /api/documents/upload/:userId  — first-time upload
documentRouter.post(
  "/upload/:userId",
  guardUserDocuments("upload"),
  userDocumentUpload.any(), // accept any field name (aadhaar / pan / marksheet10 / passbook)
  uploadDocument
);

// PUT /api/documents/update/:docId  — re-upload / update existing doc
documentRouter.put(
  "/update/:docId",
  guardDocument("upload"),
  userDocumentUpload.any(),
  updateDocument
);

// GET /api/documents/user/:userId  — fetch documents for a specific user
documentRouter.get("/user/:userId", guardUserDocuments("view"), getUserDocuments);

// GET /api/documents/file/:docId  — the file itself (uploads/documents isn't public)
documentRouter.get("/file/:docId", guardDocument("view"), getDocumentFile);

// GET /api/documents/all  — fetch all documents (SuperAdmin / Admin)
documentRouter.get("/all", employeeManagementView, getAllDocuments);

// PATCH /api/documents/:docId/status  — HR-Admin verifies/rejects a document
documentRouter.patch("/:docId/status", employeeManagementEdit, setDocumentStatus);

export default documentRouter;
