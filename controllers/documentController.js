/** @format */
import UserDocument from "../models/UserDocument.js";
import User from "../models/User.js";
import path from "path";
import fs from "fs";

// Legacy field-name → type mapping, kept only as a fallback for any client
// still using the old fixed-field-name upload form. New uploads should send
// the document's `type` (key from AdminSettings.hrmsDocumentTypes) explicitly
// in the request body instead, since the document type list is now
// admin-configurable rather than a fixed set of form fields.
const getDocTypeFromField = (field) => {
  switch (field) {
    case "aadhaar": return "AADHAAR";
    case "pan": return "PAN";
    case "marksheet10": return "MARKSHEET_12";
    case "passbook": return "PASSBOOK";
    default: return null;
  }
};

// multer `.any()` populates req.files (array), not req.file (singular) —
// resolve whichever the request actually has.
const resolveUploadedFile = (req) => req.file || (req.files && req.files[0]);

// @desc    Upload a new document
// @route   POST /api/documents/upload/:userId
export const uploadDocument = async (req, res) => {
  try {
    const { userId } = req.params;

    const file = resolveUploadedFile(req);

    if (!file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const type = req.body.type || getDocTypeFromField(file.fieldname);
    if (!type) {
      return res.status(400).json({ message: "Invalid document type" });
    }

    const targetUser = await User.findById(userId).select('companyId');
    const fileUrl = `uploads/documents/${file.filename}`;

    const newDoc = new UserDocument({
      userId,
      companyId: targetUser?.companyId || null,
      type,
      fileUrl,
      status: "UPLOADED"
    });

    await newDoc.save();

    res.status(201).json({
      message: "Document uploaded successfully",
      document: newDoc
    });
  } catch (error) {
    console.error("Error uploading document:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// @desc    Update (re-upload) an existing document
// @route   PUT /api/documents/update/:docId
export const updateDocument = async (req, res) => {
  try {
    const { docId } = req.params;

    const file = resolveUploadedFile(req);
    if (!file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const existingDoc = await UserDocument.findById(docId);
    if (!existingDoc) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Once HR has verified a document, the employee can no longer replace it —
    // matches the requirement that a verified document is locked.
    if (existingDoc.status === "VERIFIED") {
      return res.status(403).json({ message: "This document is already verified and cannot be re-uploaded" });
    }

    // Delete old file
    const oldFilePath = path.join(process.cwd(), existingDoc.fileUrl);
    if (fs.existsSync(oldFilePath)) {
      fs.unlinkSync(oldFilePath);
    }

    existingDoc.fileUrl = `uploads/documents/${file.filename}`;
    existingDoc.status = "UPLOADED"; // Reset status to uploaded if it was rejected
    existingDoc.verifiedBy = null;
    existingDoc.verifiedAt = null;
    existingDoc.remarks = '';

    await existingDoc.save();

    res.status(200).json({
      message: "Document updated successfully",
      document: existingDoc
    });
  } catch (error) {
    console.error("Error updating document:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// @desc    Get all documents for a specific user
// @route   GET /api/documents/user/:userId
export const getUserDocuments = async (req, res) => {
  try {
    const { userId } = req.params;
    const documents = await UserDocument.find({ userId });
    res.status(200).json(documents);
  } catch (error) {
    console.error("Error fetching user documents:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// @desc    Get all documents for HR-Admin's company (Document Verification list)
// @route   GET /api/documents/all
export const getAllDocuments = async (req, res) => {
  try {
    const query = {};
    // Scope to the caller's own company unless they're a platform-wide admin.
    // Scoped via the employee's own companyId rather than UserDocument.companyId
    // directly — documents uploaded before that field existed have no value
    // there, so filtering on it alone would silently hide them.
    if (!["Superadmin", "Super Admin", "super_user"].includes(req.user.role) && req.user.companyId) {
      const companyUsers = await User.find({ companyId: req.user.companyId }).select('_id').lean();
      query.userId = { $in: companyUsers.map(u => u._id) };
    }
    const documents = await UserDocument.find(query).populate("userId", "name fullName employeeId email role");
    res.status(200).json(documents);
  } catch (error) {
    console.error("Error fetching all documents:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// @desc    Verify or reject an employee's uploaded document
// @route   PATCH /api/documents/:docId/status
export const setDocumentStatus = async (req, res) => {
  try {
    const { docId } = req.params;
    const { status, remarks } = req.body;

    if (!["VERIFIED", "REJECTED"].includes(status)) {
      return res.status(400).json({ message: "Status must be VERIFIED or REJECTED" });
    }

    const doc = await UserDocument.findById(docId);
    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Restrict to the caller's own company (unless platform-wide admin).
    if (!["Superadmin", "Super Admin", "super_user"].includes(req.user.role)
      && doc.companyId && req.user.companyId
      && doc.companyId.toString() !== req.user.companyId.toString()) {
      return res.status(403).json({ message: "Access denied" });
    }

    doc.status = status;
    doc.verifiedBy = req.user._id || req.user.id;
    doc.verifiedAt = new Date();
    doc.remarks = remarks || '';
    await doc.save();

    res.status(200).json({
      message: `Document ${status === 'VERIFIED' ? 'verified' : 'rejected'} successfully`,
      document: doc
    });
  } catch (error) {
    console.error("Error setting document status:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};
