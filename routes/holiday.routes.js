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
import { hrRoleSwitch } from "../middleware/permissions.js"; // security re-check M5 (27 Nov 2026): HR needs the Holidays switch

// Holidays are HR's to change; everyone can read them (2026-11-11).
const hrOnly = authorizeRoles("HR-Admin", "Hr Admin", "Company Admin", "Superadmin", "Super Admin");

const holidayRouter = Router();

/**
 * 🔐 Protected HRMS Holiday Routes
 */
holidayRouter.use(authMiddleware);

holidayRouter.post("/", hrOnly, hrRoleSwitch("holidays", "add"), addHoliday);
holidayRouter.get("/", getAllHolidays);
holidayRouter.get("/:id", getHolidayById);
holidayRouter.put("/:id", hrOnly, hrRoleSwitch("holidays", "edit"), updateHoliday);
holidayRouter.delete("/:id", hrOnly, hrRoleSwitch("holidays", "delete"), deleteHolidayById);

export default holidayRouter;
