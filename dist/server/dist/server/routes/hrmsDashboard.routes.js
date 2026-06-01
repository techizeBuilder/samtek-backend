"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const hrmsDashboardController_js_1 = require("../controllers/hrmsDashboardController.js");
const router = express_1.default.Router();
// Apply authentication
router.use(auth_js_1.authenticateToken);
// GET /api/hrms-dashboard/stats
router.get('/stats', hrmsDashboardController_js_1.getHrmsDashboardStats);
exports.default = router;
