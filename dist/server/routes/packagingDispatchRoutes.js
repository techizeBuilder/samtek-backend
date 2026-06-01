"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const packagingDispatchController_js_1 = require("../controllers/packagingDispatchController.js");
const router = express_1.default.Router();
router.use(auth_js_1.authenticateToken);
// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', packagingDispatchController_js_1.getDashboard);
// ── Packaging Queue ───────────────────────────────────────────────────────────
router.get('/ready-for-packaging', packagingDispatchController_js_1.getReadyForPackaging);
// ── Packaging Jobs ────────────────────────────────────────────────────────────
router.get('/jobs', packagingDispatchController_js_1.getPackagingJobs);
router.post('/jobs', packagingDispatchController_js_1.createPackagingJob);
router.put('/jobs/:id/packing-type', packagingDispatchController_js_1.updatePackingType);
router.put('/jobs/:id/start', packagingDispatchController_js_1.startPacking);
router.put('/jobs/:id/checklist', packagingDispatchController_js_1.updateChecklist);
router.put('/jobs/:id/complete', packagingDispatchController_js_1.completePacking);
// ── Dispatch Orders ───────────────────────────────────────────────────────────
router.get('/dispatch-orders', packagingDispatchController_js_1.getDispatchOrders);
router.post('/dispatch-orders', packagingDispatchController_js_1.createDispatchOrder);
router.put('/dispatch-orders/:id', packagingDispatchController_js_1.updateDispatchOrder);
router.put('/dispatch-orders/:id/execute', packagingDispatchController_js_1.executeDispatch);
router.put('/dispatch-orders/:id/in-transit', packagingDispatchController_js_1.markInTransit);
router.put('/dispatch-orders/:id/deliver', packagingDispatchController_js_1.confirmDelivery);
router.put('/dispatch-orders/:id/close', packagingDispatchController_js_1.closeDispatch);
exports.default = router;
