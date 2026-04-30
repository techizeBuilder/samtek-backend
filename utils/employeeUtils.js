import User from '../models/User.js';
import { Company } from '../models/Company.js';

export const getCompanyAbbr = (companyName) => {
  if (!companyName) return "EMP";
  const letters = companyName.replace(/[^a-zA-Z]/g, "");
  return letters.substring(0, 3).toUpperCase();
};

export const generateEmployeeId = async (companyId) => {
  let abbr = "EMP";

  if (companyId) {
    const company = await Company.findById(companyId).select("name");
    if (company?.name) {
      abbr = getCompanyAbbr(company.name);
    }
  }

  const prefix = `EMP-${abbr}-`;

  const lastUser = await User.findOne({
    employeeId: { $regex: `^${prefix}` },
  })
    .sort({ createdAt: -1 })
    .select("employeeId");

  let nextNumber = 1;

  if (lastUser?.employeeId) {
    const parts = lastUser.employeeId.split("-");
    const lastNumStr = parts[parts.length - 1];
    const lastNum = parseInt(lastNumStr, 10);
    if (!isNaN(lastNum)) nextNumber = lastNum + 1;
  }

  return `${prefix}${String(nextNumber).padStart(4, "0")}`;
};
