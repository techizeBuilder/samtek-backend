import Payslip from "../models/Payslips.js";
import User from "../models/User.js";

export const getStatutoryReports = async (req, res) => {
  try {
    const { month, search, page, limit } = req.query;

    if (!month) {
      return res.status(400).json({ message: "Month is required" });
    }

    const filter = { month };

    // Company-wise isolation — HR-Admin / Company Admin only see their own
    // company's employees. Platform-wide admins see everything.
    if (!["Superadmin", "Super Admin", "super_user"].includes(req.user.role) && req.user.companyId) {
      const companyUsers = await User.find({ companyId: req.user.companyId }).select("_id").lean();
      filter.user = { $in: companyUsers.map((u) => u._id) };
    }

    const payslips = await Payslip.find(filter)
      .populate("user", "fullName username email")
      .lean();

    let reports = payslips.map((p) => {
      let employeeName = "Unknown";
      let employeeEmail = "";
      if (p.user) {
        employeeName = p.user.fullName || p.user.username || "Unknown";
        employeeEmail = p.user.email || "";
      }

      return {
        _id: p._id,
        employee: {
          name: employeeName,
          email: employeeEmail,
        },
        grossSalary: (p.basic || 0) + (p.hra || 0) + (p.otherAllowance || 0),
        pf: p.pf || 0,
        esi: 0, // ESI not explicitly stored, could be part of others
        pt: p.professionalTax || 0,
        tds: p.tds || 0,
        totalDeduction: p.deduction || 0,
        netSalary: p.netSalary || 0,
      };
    });

    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      reports = reports.filter((r) => re.test(r.employee.name) || re.test(r.employee.email));
    }

    // Pagination is opt-in via `page`.
    if (page) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.max(1, parseInt(limit) || 15);
      const total = reports.length;
      const pageItems = reports.slice((pageNum - 1) * limitNum, pageNum * limitNum);
      return res.json({
        data: pageItems,
        pagination: { current: pageNum, total: Math.ceil(total / limitNum) || 1, count: total },
      });
    }

    res.json(reports);
  } catch (error) {
    console.error("Fetch Statutory Reports Error:", error);
    res.status(500).json({ message: "Failed to load statutory reports." });
  }
};

export const generateStatutoryReports = async (req, res) => {
  try {
    const { month } = req.body;

    const filter = { month };
    if (!["Superadmin", "Super Admin", "super_user"].includes(req.user.role) && req.user.companyId) {
      const companyUsers = await User.find({ companyId: req.user.companyId }).select("_id").lean();
      filter.user = { $in: companyUsers.map((u) => u._id) };
    }

    // Statutory reports are derived from Payslips.
    // Ensure payslips exist for the month (within the caller's own company).
    const count = await Payslip.countDocuments(filter);
    if (count === 0) {
      return res.status(400).json({
        message: "No payslips found for this month. Please generate payslips first."
      });
    }

    res.json({ message: "Statutory Reports generated successfully." });
  } catch (error) {
    console.error("Generate Statutory Reports Error:", error);
    res.status(500).json({ message: "Failed to generate reports." });
  }
};
