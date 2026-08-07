/** @format */

import User from "../models/User.js";
import Attendance from "../models/Attendance.js";
import FeedbackAndRatings from "../models/FeedbackandRatings.js";
import mongoose from "mongoose";

export const getTeamPerformanceMetrics = async (req, res) => {
  try {
    const managerId = req.user._id;
    const { month, year, search, page, limit } = req.query;

    if (!month || !year) {
      return res.status(400).json({ message: "Month and Year are required" });
    }

    const mNum = Number(month); // 0-indexed from frontend
    const yNum = Number(year);

    // 1. Get Team Members
    const teamMembers = await User.find({
      reportingManager: managerId,
      isActive: true,
    }).select("fullName username role profilePicture employeeId");

    const teamIds = teamMembers.map((m) => m._id);

    if (teamIds.length === 0) {
      return res.json({
        stats: {
          teamStrength: 0,
          avgAttendance: 0,
          goalProgress: 0,
          topPerformer: "N/A",
        },
        distribution: [],
        report: [],
      });
    }

    // 2. Fetch Attendance for the month
    const startDate = new Date(yNum, mNum, 1);
    const endDate = new Date(yNum, mNum + 1, 0);

    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = endDate.toISOString().split("T")[0];

    const attendanceRecords = await Attendance.find({
      user: { $in: teamIds },
      date: { $gte: startDateStr, $lte: endDateStr },
    });

    // 3. Fetch Latest Ratings
    const ratings = await FeedbackAndRatings.find({
      employeeId: { $in: teamIds },
    }).sort({ createdAt: -1 });

    // 4. Process Data for each member
    const workingDaysInMonth = endDate.getDate(); // Simplified: actual working days would be better
    
    const processedTeam = teamMembers.map((member) => {
      const memberAttendance = attendanceRecords.filter(
        (a) => a.user.toString() === member._id.toString() && a.status === "PRESENT"
      ).length;

      const attendancePercentage = Math.round((memberAttendance / workingDaysInMonth) * 100);
      
      const memberRating = ratings.find(
        (r) => r.employeeId.toString() === member._id.toString()
      );

      const score = memberRating ? memberRating.managerRatings.overall : 0;
      
      let ratingLabel = "D - Poor";
      if (score >= 4.5) ratingLabel = "A - Excellent";
      else if (score >= 3.5) ratingLabel = "B - Good";
      else if (score >= 2.5) ratingLabel = "C - Average";

      return {
        id: member._id,
        name: member.fullName || member.username,
        role: member.role,
        profilePicture: member.profilePicture,
        attendance: {
          percentage: attendancePercentage,
          days: `${memberAttendance}/${workingDaysInMonth}`,
        },
        leaves: "0 Taken", // Placeholder for now
        goalProgress: 0, // Placeholder for now
        score: score,
        rating: ratingLabel,
      };
    });

    // 5. Calculate Global Stats
    const avgAttendance = Math.round(
      processedTeam.reduce((acc, m) => acc + m.attendance.percentage, 0) / processedTeam.length
    );

    const topPerformer = processedTeam.length > 0 
      ? processedTeam.reduce((prev, current) => (prev.score > current.score) ? prev : current)
      : null;

    const distribution = [
      { name: "Excellent (A)", value: processedTeam.filter(m => m.score >= 4.5).length, color: "#10b981" },
      { name: "Good (B)", value: processedTeam.filter(m => m.score >= 3.5 && m.score < 4.5).length, color: "#3b82f6" },
      { name: "Average (C)", value: processedTeam.filter(m => m.score >= 2.5 && m.score < 3.5).length, color: "#f59e0b" },
      { name: "Poor (D)", value: processedTeam.filter(m => m.score < 2.5).length, color: "#f43f5e" },
    ];

    // Search/pagination apply only to the `report` table — stats/distribution
    // above are already computed from the full team and stay unaffected.
    let report = processedTeam;
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      report = report.filter((m) => re.test(m.name || ''));
    }

    let reportPagination;
    if (page) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.max(1, parseInt(limit) || 15);
      const total = report.length;
      reportPagination = { current: pageNum, total: Math.ceil(total / limitNum) || 1, count: total };
      report = report.slice((pageNum - 1) * limitNum, pageNum * limitNum);
    }

    res.json({
      stats: {
        teamStrength: teamMembers.length,
        avgAttendance: avgAttendance,
        goalProgress: 1, // Static for now
        topPerformer: topPerformer ? topPerformer.name : "N/A",
      },
      distribution,
      report,
      ...(reportPagination ? { pagination: reportPagination } : {}),
    });
  } catch (error) {
    console.error("Error in getTeamPerformanceMetrics:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
