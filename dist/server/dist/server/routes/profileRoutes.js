"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const profileController_js_1 = require("../controllers/profileController.js");
const router = express_1.default.Router();
// All routes require authentication
router.use(auth_js_1.authenticateToken);
// GET /api/profile - Get current user's profile
router.get('/profile', profileController_js_1.getProfile);
// PUT /api/profile - Update profile (fullName, email)
router.put('/profile', profileController_js_1.updateProfile);
// PUT /api/profile/password - Change password
router.put('/profile/password', profileController_js_1.changePassword);
// POST /api/profile/picture - Upload profile picture
router.post('/profile/picture', profileController_js_1.uploadProfilePicture);
exports.default = router;
