import User from "../models/User.js";
import Attendance from "../models/Attendance.js";
import Payroll from "../models/Payroll.js";
import JobOpening from "../models/JobOpenings.js";
import Holiday from "../models/Holiday.js";

export const getHrmsDashboardStats = async (req, res) => {
  try {
    const userCompanyId = req.user?.companyId;

    if (!userCompanyId) {
      return res.status(400).json({
        success: false,
        message: "User company association is required to view dashboard."
      });
    }

    // Find all users associated with this company
    const usersInCompany = await User.find({ companyId: userCompanyId }).select('_id');
    const userIds = usersInCompany.map(u => u._id);

    // 1. Total Employees
    const totalEmployees = await User.countDocuments({ isActive: true, companyId: userCompanyId });

    // 2. Present Today
    const today = new Date();
    const offset = today.getTimezoneOffset();
    const todayString = new Date(today.getTime() - (offset * 60 * 1000)).toISOString().split('T')[0];

    const presentToday = await Attendance.countDocuments({ 
      date: todayString, 
      status: "PRESENT",
      user: { $in: userIds }
    });

    // 3. Pending Payroll
    const pendingPayroll = await Payroll.countDocuments({ 
      status: "Draft",
      employee: { $in: userIds }
    });

    // 4. Open Jobs
    // JobOpening schema does not have companyId directly, so we filter by recruitingManager belonging to the company
    const openJobs = await JobOpening.countDocuments({ 
      status: "Open",
      recruitingManager: { $in: userIds }
    });

    // 5. Recent Attendance
    const recentAttendance = await Attendance.find({ 
      date: todayString,
      user: { $in: userIds }
    })
      .populate("user", "fullName employeeId profilePicture")
      .sort({ createdAt: -1 })
      .limit(5);

    // 6. Upcoming Holidays
    const upcomingHolidays = await Holiday.find({
      date: { $gte: new Date() },
      isActive: true,
      $or: [
        { companyId: userCompanyId },
        { companyId: { $exists: false } },
        { companyId: null }
      ]
    })
      .sort({ date: 1 })
      .limit(5);

    res.status(200).json({
      success: true,
      data: {
        totalEmployees,
        presentToday,
        pendingPayroll,
        openJobs,
        recentAttendance,
        upcomingHolidays
      }
    });
  } catch (error) {
    console.error("Error fetching HRMS dashboard stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch HRMS dashboard stats",
      error: error.message
    });
  }
};
