/** @format */
import UserDocument from "../models/UserDocument.js";
import path from "path";
import fs from "fs";

// Helper to get document type from field name
const getDocTypeFromField = (field) => {
  switch (field) {
    case "aadhaar": return "AADHAAR";
    case "pan": return "PAN";
    case "marksheet10": return "MARKSHEET_12";
    case "passbook": return "PASSBOOK";
    default: return null;
  }
};

// @desc    Upload a new document
// @route   POST /api/documents/upload/:userId
export const uploadDocument = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const file = req.file || (req.files && req.files[0]);
    
    if (!file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const type = getDocTypeFromField(file.fieldname);
    if (!type) {
      return res.status(400).json({ message: "Invalid document field" });
    }

    const fileUrl = `uploads/documents/${file.filename}`;

    const newDoc = new UserDocument({
      userId,
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

// @desc    Update an existing document
// @route   PUT /api/documents/update/:docId
export const updateDocument = async (req, res) => {
  try {
    const { docId } = req.params;

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const existingDoc = await UserDocument.findById(docId);
    if (!existingDoc) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Delete old file
    const oldFilePath = path.join(process.cwd(), existingDoc.fileUrl);
    if (fs.existsSync(oldFilePath)) {
      fs.unlinkSync(oldFilePath);
    }

    existingDoc.fileUrl = `uploads/documents/${req.file.filename}`;
    existingDoc.status = "UPLOADED"; // Reset status to uploaded if it was verified/rejected
    
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

// @desc    Get all documents (for Admin/SuperAdmin)
// @route   GET /api/documents/all
export const getAllDocuments = async (req, res) => {
  try {
    const documents = await UserDocument.find().populate("userId", "name fullName employeeId email");
    res.status(200).json(documents);
  } catch (error) {
    console.error("Error fetching all documents:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};
