"use strict";
/** @format */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTeamPerformanceMetrics = void 0;
const User_js_1 = __importDefault(require("../models/User.js"));
const Attendance_js_1 = __importDefault(require("../models/Attendance.js"));
const FeedbackandRatings_js_1 = __importDefault(require("../models/FeedbackandRatings.js"));
const mongoose_1 = __importDefault(require("mongoose"));
const getTeamPerformanceMetrics = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const managerId = req.user._id;
        const { month, year } = req.query;
        if (!month || !year) {
            return res.status(400).json({ message: "Month and Year are required" });
        }
        const mNum = Number(month); // 0-indexed from frontend
        const yNum = Number(year);
        // 1. Get Team Members
        const teamMembers = yield User_js_1.default.find({
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
        const attendanceRecords = yield Attendance_js_1.default.find({
            user: { $in: teamIds },
            date: { $gte: startDateStr, $lte: endDateStr },
        });
        // 3. Fetch Latest Ratings
        const ratings = yield FeedbackandRatings_js_1.default.find({
            employeeId: { $in: teamIds },
        }).sort({ createdAt: -1 });
        // 4. Process Data for each member
        const workingDaysInMonth = endDate.getDate(); // Simplified: actual working days would be better
        const processedTeam = teamMembers.map((member) => {
            const memberAttendance = attendanceRecords.filter((a) => a.user.toString() === member._id.toString() && a.status === "PRESENT").length;
            const attendancePercentage = Math.round((memberAttendance / workingDaysInMonth) * 100);
            const memberRating = ratings.find((r) => r.employeeId.toString() === member._id.toString());
            const score = memberRating ? memberRating.managerRatings.overall : 0;
            let ratingLabel = "D - Poor";
            if (score >= 4.5)
                ratingLabel = "A - Excellent";
            else if (score >= 3.5)
                ratingLabel = "B - Good";
            else if (score >= 2.5)
                ratingLabel = "C - Average";
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
        const avgAttendance = Math.round(processedTeam.reduce((acc, m) => acc + m.attendance.percentage, 0) / processedTeam.length);
        const topPerformer = processedTeam.length > 0
            ? processedTeam.reduce((prev, current) => (prev.score > current.score) ? prev : current)
            : null;
        const distribution = [
            { name: "Excellent (A)", value: processedTeam.filter(m => m.score >= 4.5).length, color: "#10b981" },
            { name: "Good (B)", value: processedTeam.filter(m => m.score >= 3.5 && m.score < 4.5).length, color: "#3b82f6" },
            { name: "Average (C)", value: processedTeam.filter(m => m.score >= 2.5 && m.score < 3.5).length, color: "#f59e0b" },
            { name: "Poor (D)", value: processedTeam.filter(m => m.score < 2.5).length, color: "#f43f5e" },
        ];
        res.json({
            stats: {
                teamStrength: teamMembers.length,
                avgAttendance: avgAttendance,
                goalProgress: 1, // Static for now
                topPerformer: topPerformer ? topPerformer.name : "N/A",
            },
            distribution,
            report: processedTeam,
        });
    }
    catch (error) {
        console.error("Error in getTeamPerformanceMetrics:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});
exports.getTeamPerformanceMetrics = getTeamPerformanceMetrics;
