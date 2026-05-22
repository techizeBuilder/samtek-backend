import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  getMyBalances,
  getCurrentBalance,
  getHistory,
  overrideBalance
} from "../controllers/leaveBalanceAdjustmentController.js";

const leaveBalanceAdjustmentRouter = Router();

leaveBalanceAdjustmentRouter.get("/my-balances", authMiddleware, getMyBalances);
leaveBalanceAdjustmentRouter.get("/current", authMiddleware, getCurrentBalance);
leaveBalanceAdjustmentRouter.get("/history", authMiddleware, getHistory);
leaveBalanceAdjustmentRouter.post("/override", authMiddleware, overrideBalance);

export default leaveBalanceAdjustmentRouter;
