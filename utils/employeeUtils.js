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

  // 27 Nov 2026: the highest number in use + 1, as HR's bulk import does (services/bulkImport/peopleImport.js
  // nextEmployeeIds). It used to take the most recently CREATED user's number: after an import (several
  // people saved at the same moment) that could be a lower one, and the next Add User failed with
  // "employeeId already exists". Bounded by the prefix (one company's people), on the employeeId index.
  const used = await User.distinct("employeeId", { employeeId: { $regex: `^${prefix}` } });
  const high = Math.max(0, ...used.map((id) => parseInt(String(id).split("-").pop(), 10)).filter((n) => !Number.isNaN(n)));

  return `${prefix}${String(high + 1).padStart(4, "0")}`;
};
