"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const companyController_js_1 = require("../controllers/companyController.js");
const auth_js_1 = require("../middleware/auth.js");
const router = express_1.default.Router();
// Public routes (no authentication required)
router.get('/simple', companyController_js_1.getCompaniesSimple);
// Apply authentication middleware to protected routes
router.use(auth_js_1.authenticateToken);
// Company routes
router.get('/dropdown', companyController_js_1.getCompaniesDropdown);
router.get('/stats', companyController_js_1.getCompanyStats);
router.get('/', companyController_js_1.getCompanies);
router.get('/:id', companyController_js_1.getCompanyById);
router.post('/', companyController_js_1.createCompany);
router.put('/:id', companyController_js_1.updateCompany);
router.delete('/:id', companyController_js_1.deleteCompany);
exports.default = router;
