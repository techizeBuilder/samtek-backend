"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/** @format */
const express_1 = require("express");
const auth_js_1 = require("../middleware/auth.js");
const uploadUserDocument_js_1 = require("../utils/uploadUserDocument.js");
const documentController_js_1 = require("../controllers/documentController.js");
const documentRouter = (0, express_1.Router)();
documentRouter.use(auth_js_1.authMiddleware);
// POST /api/documents/upload/:userId  — first-time upload
documentRouter.post("/upload/:userId", uploadUserDocument_js_1.userDocumentUpload.any(), // accept any field name (aadhaar / pan / marksheet10 / passbook)
documentController_js_1.uploadDocument);
// PUT /api/documents/update/:docId  — re-upload / update existing doc
documentRouter.put("/update/:docId", uploadUserDocument_js_1.userDocumentUpload.any(), documentController_js_1.updateDocument);
// GET /api/documents/user/:userId  — fetch documents for a specific user
documentRouter.get("/user/:userId", documentController_js_1.getUserDocuments);
// GET /api/documents/all  — fetch all documents (SuperAdmin / Admin)
documentRouter.get("/all", documentController_js_1.getAllDocuments);
exports.default = documentRouter;
