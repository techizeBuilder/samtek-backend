import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = 'uploads/profiles/';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  }
});

export const profileUpload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allow only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Add Employee with no login (2026-11-06): the optional photo, the required Aadhaar
// and any other documents (field doc_<TYPE>) arrive together, and each goes where
// its kind of file already lives.
const isDocumentField = (name) => name === 'aadhaar' || /^doc_[\w-]+$/.test(name);

const manpowerStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = isDocumentField(file.fieldname) ? 'uploads/documents/' : 'uploads/profiles/';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const prefix = isDocumentField(file.fieldname) ? 'doc-' : 'profile-';
    cb(null, prefix + uniqueSuffix + path.extname(file.originalname));
  }
});

const manpowerFields = multer({
  storage: manpowerStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 20 }, // 10MB, the document limit
  fileFilter: function (req, file, cb) {
    if (isDocumentField(file.fieldname)) {
      return ['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype)
        ? cb(null, true)
        : cb(new Error('Documents must be a PDF, JPG or PNG file.'), false);
    }
    if (file.fieldname !== 'profilePicture') return cb(new Error('Unexpected file.'), false);
    return file.mimetype.startsWith('image/')
      ? cb(null, true)
      : cb(new Error('Only image files are allowed!'), false);
  }
}).any();

// A bad file is the user's to fix, so it's a 400 with the reason.
export const manpowerUpload = (req, res, next) => manpowerFields(req, res, (err) => (
  err ? res.status(400).json({ success: false, message: err.message }) : next()
));
