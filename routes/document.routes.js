/** @format */
import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
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
documentRouter.get("/all", getAllDocuments);

// PATCH /api/documents/:docId/status  — HR-Admin verifies/rejects a document
documentRouter.patch("/:docId/status", setDocumentStatus);

export default documentRouter;
