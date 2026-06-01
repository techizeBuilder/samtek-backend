"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_js_1 = require("../middleware/auth.js");
const profileUpdateController_js_1 = require("../controllers/profileUpdateController.js");
const ProfileUpdateRouter = (0, express_1.Router)();
ProfileUpdateRouter.use(auth_js_1.authMiddleware);
// Employee
ProfileUpdateRouter.post("/", profileUpdateController_js_1.createProfileUpdate);
ProfileUpdateRouter.get("/me", profileUpdateController_js_1.getMyProfileUpdates);
// Manager
ProfileUpdateRouter.get("/manager", profileUpdateController_js_1.getTeamProfileUpdateRequests);
ProfileUpdateRouter.patch("/:id/status", profileUpdateController_js_1.updateProfileUpdate);
exports.default = ProfileUpdateRouter;
