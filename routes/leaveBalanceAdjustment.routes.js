import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { checkPermission, checkAnyPermission } from "../middleware/permissions.js";
// Approving and listing other people's requests needs a permission (2026-11-11).
const can = (feature, action) => checkPermission("hrms", feature, action);
const canAny = (features, action) => checkAnyPermission(features.map((f) => ["hrms", f]), action);
import {
  getMyBalances,
  getCurrentBalance,
  getHistory,
  overrideBalance
} from "../controllers/leaveBalanceAdjustmentController.js";

const leaveBalanceAdjustmentRouter = Router();

leaveBalanceAdjustmentRouter.get("/my-balances", authMiddleware, getMyBalances);
leaveBalanceAdjustmentRouter.get("/current", authMiddleware, canAny(["leaveTypes", "leaveRequests"], "view"), getCurrentBalance);
leaveBalanceAdjustmentRouter.get("/history", authMiddleware, canAny(["leaveTypes", "leaveRequests"], "view"), getHistory);
leaveBalanceAdjustmentRouter.post("/override", authMiddleware, canAny(["leaveTypes", "leaveRequests"], "edit"), overrideBalance);

export default leaveBalanceAdjustmentRouter;
