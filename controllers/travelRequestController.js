/** @format */

import TravelRequest from "../models/TravelRequest.js";
import User from "../models/User.js";

/* ================= CREATE ================= */
export const createTravelRequest = async (req, res) => {
  try {
    const { purpose, destination, fromDate, toDate, budget, remarks } =
      req.body;

    const request = await TravelRequest.create({
      employee: req.user._id,
      purpose,
      destination,
      fromDate,
      toDate,
      budget,
      remarks,

      // 👇 initially finance fields empty
      payable: undefined,
      paymentStatus: "UNPAID",

      // 👇 if receipt uploaded
      receiptUrl: req.file ? `/uploads/travel/${req.file.filename}` : undefined,

      status: "PENDING",
    });

    res.status(201).json(request);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to create travel request",
    });
  }
};

/* ================= GET MY REQUESTS (EMPLOYEE) ================= */
export const getMyTravelRequests = async (req, res) => {
  try {
    const requests = await TravelRequest.find({
      employee: req.user._id,
    }).sort({ createdAt: -1 });

    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch travel requests" });
  }
};

/* ================= GET ALL (HR / ADMIN) ================= */
export const getAllTravelRequests = async (req, res) => {
  try {
    const requests = await TravelRequest.find()
      .populate("employee", "name email")
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch requests" });
  }
};

/* ================= UPDATE (VIEW / EDIT) ================= */
export const updateTravelRequest = async (req, res) => {
  try {
    const request = await TravelRequest.findOneAndUpdate(
      {
        _id: req.params.id,
      },
      req.body,
      { new: true },
    );
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    res.json(request);
  } catch (error) {
    res.status(500).json({ message: "Failed to update request" });
  }
};

/* ================= DELETE ================= */
export const deleteTravelRequest = async (req, res) => {
  try {
    const request = await TravelRequest.findOneAndDelete({
      _id: req.params.id,
      employee: req.user._id,
    });

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    res.json({ message: "Travel request deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete request" });
  }
};

/* ================= APPROVE / REJECT (HR) ================= */
export const updateTravelRequestStatus = async (
  req,
  res,
) => {
  try {
    const { status } = req.body;

    const request = await TravelRequest.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true },
    );

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    res.json(request);
  } catch (error) {
    res.status(500).json({ message: "Failed to update status" });
  }
};
export const getManagerTravelRequests = async (
  req,
  res,
) => {
  try {
    const managerId = req.user._id;

    const team = await User.find({ managerId }, "_id");
    const employeeIds = team.map((u) => u._id);

    const requests = await TravelRequest.find({
      employee: { $in: employeeIds },
    })
      .populate("employee", "name email")
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch manager travel requests",
    });
  }
};
export const updateManagerTravelStatus = async (
  req,
  res,
) => {
  try {
    const { status } = req.body;

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const request = await TravelRequest.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true },
    );

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    res.json(request);
  } catch (error) {
    res.status(500).json({ message: "Failed to update status" });
  }
};
export const uploadTravelReceipt = async (req, res) => {
  try {

    const travel = await TravelRequest.findById(req.params.id);


    if (!travel) {
      return res.status(404).json({ message: "Travel request not found" });
    }

    if (travel.status?.toUpperCase() !== "APPROVED") {
      return res
        .status(400)
        .json({ message: "Receipt allowed only for approved travel" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Receipt file required" });
    }

    travel.receiptUrl = `/uploads/travel/${req.file.filename}`;
    await travel.save();

    res.json(travel);
  } catch (error) {
    res.status(500).json({
      message: error.message || "Failed to upload receipt",
    });
  }
};
