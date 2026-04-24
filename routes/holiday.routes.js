/** @format */

import { Router } from "express";
import { 
  addHoliday,
  getAllHolidays,
  getHolidayById,
  updateHoliday,
  deleteHolidayById 
} from "../controllers/holidayController.js";
import { authMiddleware } from "../middleware/auth.js";

const holidayRouter = Router();

/**
 * 🔐 Protected HRMS Holiday Routes
 */
holidayRouter.use(authMiddleware);

holidayRouter.post("/", addHoliday);
holidayRouter.get("/", getAllHolidays);
holidayRouter.get("/:id", getHolidayById);
holidayRouter.put("/:id", updateHoliday);
holidayRouter.delete("/:id", deleteHolidayById);

export default holidayRouter;
