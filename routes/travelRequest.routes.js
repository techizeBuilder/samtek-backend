/** @format */

import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  createTravelRequest,
  getMyTravelRequests,
  getManagerTravelRequests,
  updateManagerTravelStatus,
  getAllTravelRequests,
  updateTravelRequest,
  deleteTravelRequest,
  uploadTravelReceipt,
} from "../controllers/travelRequestController.js";
import { travelUpload } from "../utils/travelUpload.js";

const TravelRequestRouter = Router();

TravelRequestRouter.use(authMiddleware);

// Employee
TravelRequestRouter.post("/", travelUpload.single("receipt"), createTravelRequest);
TravelRequestRouter.get("/me", getMyTravelRequests);
TravelRequestRouter.put("/:id", travelUpload.single("receipt"), updateTravelRequest);
TravelRequestRouter.delete("/:id", deleteTravelRequest);
TravelRequestRouter.post("/:id/receipt", travelUpload.single("receipt"), uploadTravelReceipt);

// Manager
TravelRequestRouter.get("/manager", getManagerTravelRequests);
TravelRequestRouter.patch("/:id/status", updateManagerTravelStatus);

// Admin/HR
TravelRequestRouter.get("/all", getAllTravelRequests);

export default TravelRequestRouter;
