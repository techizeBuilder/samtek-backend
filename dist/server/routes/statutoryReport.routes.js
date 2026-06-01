"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const statutoryReportController_js_1 = require("../controllers/statutoryReportController.js");
const auth_js_1 = require("../middleware/auth.js");
const router = (0, express_1.Router)();
router.get("/", auth_js_1.authMiddleware, statutoryReportController_js_1.getStatutoryReports);
router.post("/generate", auth_js_1.authMiddleware, statutoryReportController_js_1.generateStatutoryReports);
exports.default = router;
