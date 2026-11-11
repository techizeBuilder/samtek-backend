/** @format */

import { Router } from "express";
import { 
  addHoliday,
  getAllHolidays,
  getHolidayById,
  updateHoliday,
  deleteHolidayById 
} from "../controllers/holidayController.js";
import { authMiddleware, authorizeRoles } from "../middleware/auth.js";

// Holidays are HR's to change; everyone can read them (2026-11-11).
const hrOnly = authorizeRoles("HR-Admin", "Hr Admin", "Company Admin", "Superadmin", "Super Admin");

const holidayRouter = Router();

/**
 * 🔐 Protected HRMS Holiday Routes
 */
holidayRouter.use(authMiddleware);

holidayRouter.post("/", hrOnly, addHoliday);
holidayRouter.get("/", getAllHolidays);
holidayRouter.get("/:id", getHolidayById);
holidayRouter.put("/:id", hrOnly, updateHoliday);
holidayRouter.delete("/:id", hrOnly, deleteHolidayById);

export default holidayRouter;
