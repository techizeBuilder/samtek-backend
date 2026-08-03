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
    const { page, limit } = req.query;
    const query = { employee: req.user._id };

    if (page || limit) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 20);
      const [requests, total] = await Promise.all([
        TravelRequest.find(query).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum),
        TravelRequest.countDocuments(query),
      ]);
      return res.json({
        data: requests,
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
      });
    }

    const requests = await TravelRequest.find(query).sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch travel requests" });
  }
};

/* ================= GET ALL (HR / ADMIN) ================= */
export const getAllTravelRequests = async (req, res) => {
  try {
    const fetchedRequests = await TravelRequest.find()
      .populate("employee", "fullName username email")
      .sort({ createdAt: -1 })
      .lean();

    const requests = fetchedRequests.map(r => {
      if (r.employee) {
        r.employee.name = r.employee.fullName || r.employee.username || 'Unknown';
      }
      return r;
    });

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

    const team = await User.find({ reportingManager: managerId }, "_id");
    const employeeIds = team.map((u) => u._id);

    const fetchedRequests = await TravelRequest.find({
      employee: { $in: employeeIds },
    })
      .populate("employee", "fullName username email")
      .sort({ createdAt: -1 })
      .lean();

    const requests = fetchedRequests.map(r => {
      if (r.employee) {
        r.employee.name = r.employee.fullName || r.employee.username || 'Unknown';
      }
      return r;
    });

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
