"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const holidayController_js_1 = require("../controllers/holidayController.js");
const auth_js_1 = require("../middleware/auth.js");
const holidayRouter = (0, express_1.Router)();
/**
 * 🔐 Protected HRMS Holiday Routes
 */
holidayRouter.use(auth_js_1.authMiddleware);
holidayRouter.post("/", holidayController_js_1.addHoliday);
holidayRouter.get("/", holidayController_js_1.getAllHolidays);
holidayRouter.get("/:id", holidayController_js_1.getHolidayById);
holidayRouter.put("/:id", holidayController_js_1.updateHoliday);
holidayRouter.delete("/:id", holidayController_js_1.deleteHolidayById);
exports.default = holidayRouter;
