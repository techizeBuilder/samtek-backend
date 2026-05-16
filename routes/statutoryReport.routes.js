import { Router } from "express";
import { getStatutoryReports, generateStatutoryReports } from "../controllers/statutoryReportController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

router.get("/", authMiddleware, getStatutoryReports);
router.post("/generate", authMiddleware, generateStatutoryReports);

export default router;
