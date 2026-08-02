/** @format */

import Payslip from "../models/Payslips.js";
import Payroll from "../models/Payroll.js";
import generatePayslipPDF from "../utils/generatePayslipPDF.js";
import SalaryStructure from "../models/SalaryStructure.js";
import { sendCommonEmail, CommonEmailType } from "../utils/email.js";

/* ================= GENERATE PAYSLIPS FROM PAYROLL ================= */
export const generatePayslipsFromPayroll = async (
  req,
  res,
) => {
  try {
    const { month } = req.body;

    // 1️⃣ Sirf PAID payroll uthao
    const payrolls = await Payroll.find({
      month,
      status: "Paid",
    }).populate("employee", "fullName username email");

    if (!payrolls.length) {
      return res.status(404).json({
        message: "No paid payroll found for this month",
      });
    }

    const createdPayslips = [];

    for (const payroll of payrolls) {
      const employee = payroll.employee;
      if (!employee) continue;

      // 2️⃣ Duplicate payslip check
      const exists = await Payslip.findOne({
        user: employee._id,
        month,
      });

      if (exists) continue;

      // 3️⃣ Salary structure uthao
      const salary = await SalaryStructure.findOne({
        employee: employee._id,
      });

      if (!salary) continue;

      // 🔍 YTD Calculations
      const [year, monthVal] = month.split("-").map(Number);
      // Financial Year start (April)
      const fiscalYearStartYear = monthVal < 4 ? year - 1 : year;
      const startMonth = `${fiscalYearStartYear}-04`;
      
      const previousPayslips = await Payslip.find({
        user: employee._id,
        month: { $gte: startMonth, $lt: month }
      });

      const ytd = (field) => {
        const prevTotal = previousPayslips.reduce((acc, curr) => acc + (curr[field] || 0), 0);
        return prevTotal + (salary[field] || 0);
      };

      // 4️⃣ Payslip create
      const payslip = await Payslip.create({
        user: employee._id,
        payroll: payroll._id,
        month,

        // 🔥 Salary breakdown (snaphost)
        basic: salary.basic,
        hra: salary.hra,
        otherAllowance: salary.otherAllowance,

        pf: salary.pf,
        professionalTax: salary.professionalTax,
        tds: salary.tds,
        advance: salary.advance,
        others: salary.others,

        // 📅 Days
        payDays: 30, // Default for now
        lopDays: 0,

        // 📈 YTD Snapshots
        ytdBasic: ytd("basic"),
        ytdHra: ytd("hra"),
        ytdOtherAllowance: ytd("otherAllowance"),
        ytdPf: ytd("pf"),
        ytdProfessionalTax: ytd("professionalTax"),
        ytdTds: ytd("tds"),
        ytdAdvance: ytd("advance"),
        ytdOthers: ytd("others"),

        // 🔥 Payroll calculation (actual paid)
        deduction: payroll.deduction,
        netSalary: payroll.net,

        status: "Generated",
      });

      createdPayslips.push(payslip);

      // 📧 EMAIL SEND (sirf jiski payslip bani)
      if (employee.email) {
        await sendCommonEmail({
          type: CommonEmailType.PAYSLIP_GENERATED,
          to: employee.email,
          name: employee.fullName || employee.username || 'Employee',
          data: {
            month,
            downloadUrl: `${process.env.FRONTEND_URL}/payslip/${payslip._id}`,
          },
        });
      }
    }

    res.status(201).json({
      message: "Payslips generated successfully",
      count: createdPayslips.length,
      payslips: createdPayslips, // 👈 direct return
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Payslip generation failed",
      error: error.message,
    });
  }
};


/* ================= HR: GET ALL PAYSLIPS ================= */
export const getAllPayslips = async (req, res) => {
  try {
    const filter = {};

    // Company-wise isolation
    if (req.user && req.user.role !== 'Super Admin' && req.user.role !== 'Superadmin' && req.user.companyId) {
      const companyUsers = await (await import('../models/User.js')).default
        .find({ companyId: req.user.companyId }, "_id");
      filter.user = { $in: companyUsers.map(u => u._id) };
    }

    const payslips = await Payslip.find(filter)
      .populate("user", "fullName username email role")
      .populate("payroll")
      .sort({ createdAt: -1 });

    const formattedPayslips = payslips.map(p => {
      const pObj = p.toObject();
      if (pObj.user) {
        pObj.user.name = pObj.user.fullName || pObj.user.username || 'Unknown';
      }
      return pObj;
    });

    res.json(formattedPayslips);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};



/* ================= DOWNLOAD PAYSLIP PDF ================= */
export const downloadPayslipPDF = async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id)
      .populate({
        path: "user",
        populate: [
          { path: "designationId", select: "name" },
          { path: "departmentId", select: "name" },
          { path: "branchId", select: "name" },
          { path: "companyId", select: "name address logo" }
        ],
        select: "fullName username email employeeId joiningDate pan pfNumber uan bankName bankAccountNumber ifscCode elBalance slBalance"
      })
      .populate("payroll");

    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    const pdfPath = await generatePayslipPDF(payslip);
    res.download(pdfPath);
  } catch (error) {
    res.status(500).json({
      message: "PDF download failed",
      error: error.message,
    });
  }
};

/* ================= SEND PAYSLIP ================= */
export const sendPayslipToEmployee = async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id).populate(
      "user",
      "email fullName username"
    );

    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    await generatePayslipPDF(payslip);

    payslip.status = "Sent";
    payslip.sentAt = new Date();
    await payslip.save();

    res.json({ message: "Payslip sent successfully" });
  } catch (error) {
    res.status(500).json({
      message: "Failed to send payslip",
      error: error.message,
    });
  }
};

/* ================= EMPLOYEE: MY PAYSLIPS ================= */
export const getMyPayslips = async (req, res) => {
  try {
    const userId = req.user._id || req.user.userId || req.user.id;
    const { month, year } = req.query;

    // month is stored as "YYYY-MM"; filter here instead of fetching every
    // payslip ever issued and filtering client-side.
    const query = { user: userId };
    if (month && year) {
      query.month = `${year}-${String(month).padStart(2, '0')}`;
    } else if (year) {
      query.month = { $regex: `^${year}-` };
    } else if (month) {
      query.month = { $regex: `-${String(month).padStart(2, '0')}$` };
    }

    const payslips = await Payslip.find(query)
      .populate("payroll")
      .sort({ month: -1 });

    res.json(payslips);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ================= DELETE ALL PAYSLIPS ================= */
export const deleteAllPayslips = async (_req, res) => {
  try {
    const result = await Payslip.deleteMany({});

    res.json({
      message: "All payslips deleted successfully",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to delete payslips",
      error: error.message,
    });
  }
};
