"use strict";
/** @format */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_js_1 = require("../middleware/auth.js");
const travelRequestController_js_1 = require("../controllers/travelRequestController.js");
const travelUpload_js_1 = require("../utils/travelUpload.js");
const TravelRequestRouter = (0, express_1.Router)();
TravelRequestRouter.use(auth_js_1.authMiddleware);
// Employee
TravelRequestRouter.post("/", travelUpload_js_1.travelUpload.single("receipt"), travelRequestController_js_1.createTravelRequest);
TravelRequestRouter.get("/me", travelRequestController_js_1.getMyTravelRequests);
TravelRequestRouter.put("/:id", travelUpload_js_1.travelUpload.single("receipt"), travelRequestController_js_1.updateTravelRequest);
TravelRequestRouter.delete("/:id", travelRequestController_js_1.deleteTravelRequest);
TravelRequestRouter.post("/:id/receipt", travelUpload_js_1.travelUpload.single("receipt"), travelRequestController_js_1.uploadTravelReceipt);
// Manager
TravelRequestRouter.get("/manager", travelRequestController_js_1.getManagerTravelRequests);
TravelRequestRouter.patch("/:id/status", travelRequestController_js_1.updateManagerTravelStatus);
// Admin/HR
TravelRequestRouter.get("/all", travelRequestController_js_1.getAllTravelRequests);
exports.default = TravelRequestRouter;
