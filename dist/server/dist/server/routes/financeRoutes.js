"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const financeController_js_1 = require("../controllers/financeController.js");
const auth_js_1 = require("../middleware/auth.js");
const router = express_1.default.Router();
router.use(auth_js_1.authenticateToken);
router.get('/summary', financeController_js_1.getFinanceSummary);
exports.default = router;
