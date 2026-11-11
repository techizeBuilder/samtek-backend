import { Router } from "express";
import { getStatutoryReports, generateStatutoryReports } from "../controllers/statutoryReportController.js";
import { authMiddleware } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

const router = Router();

router.get("/", authMiddleware, checkPermission("hrms", "statutoryReport", "view"), getStatutoryReports);
router.post("/generate", authMiddleware, checkPermission("hrms", "statutoryReport", "add"), generateStatutoryReports);

export default router;
