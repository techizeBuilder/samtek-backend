/** @format */
import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { getAttendancePolicy, updateAttendancePolicy } from "../controllers/attendancePolicyController.js";

const attendancePolicyRouter = Router();
attendancePolicyRouter.use(authMiddleware);

attendancePolicyRouter.get("/", getAttendancePolicy);
attendancePolicyRouter.put("/", updateAttendancePolicy);

export default attendancePolicyRouter;
