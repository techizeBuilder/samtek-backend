/** @format */
import fs from "fs";
import path from "path";

/**
 * 📄 Mock Payslip PDF Generator
 */
const generatePayslipPDF = async (payslip) => {
  // Use process.cwd() to avoid __dirname issues in ESM/CJS mixed environments
  const dir = path.join(process.cwd(), "uploads", "payslips");
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filename = `payslip_${payslip._id}.pdf`;
  const filePath = path.join(dir, filename);

  fs.writeFileSync(filePath, `PAYSLIP FOR ${payslip.user?.name}\nMonth: ${payslip.month}\nNet Salary: ${payslip.netSalary}`);

  return filePath;
};

export default generatePayslipPDF;
