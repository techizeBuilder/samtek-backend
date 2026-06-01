"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const purchaseRequestController_js_1 = require("../controllers/purchaseRequestController.js");
const auth_js_1 = require("../middleware/auth.js");
const router = express_1.default.Router();
router.use(auth_js_1.authenticateToken);
router.get('/', purchaseRequestController_js_1.getPurchaseRequests);
router.post('/', purchaseRequestController_js_1.createPurchaseRequest);
router.patch('/:id/status', purchaseRequestController_js_1.updatePurchaseRequestStatus);
exports.default = router;
