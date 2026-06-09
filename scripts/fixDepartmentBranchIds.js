/**
 * One-time migration script
 * Fixes departments where branchId was incorrectly saved as Company._id
 * instead of an actual Branch._id
 *
 * Run: node --experimental-vm-modules scripts/fixDepartmentBranchIds.js
 * OR via the API endpoint: GET /api/admin/fix-department-branches (Super Admin only)
 */

import mongoose from "mongoose";
import connectDB from "../config/database.js";
import Department from "../models/Department.js";
import Branch from "../models/Branch.js";

export const fixDepartmentBranchIds = async () => {
  const results = {
    total: 0,
    alreadyCorrect: 0,
    fixed: 0,
    noBranchFound: [],
    errors: [],
  };

  // Fetch all departments
  const departments = await Department.find({});
  results.total = departments.length;

  // Get all branch IDs (the valid ones)
  const allBranches = await Branch.find({});
  const branchIdSet = new Set(allBranches.map((b) => b._id.toString()));

  for (const dept of departments) {
    try {
      const branchIdStr = dept.branchId?.toString();

      // Check if branchId already points to a valid Branch
      if (branchIdStr && branchIdSet.has(branchIdStr)) {
        results.alreadyCorrect++;
        continue;
      }

      // branchId is invalid (likely a Company._id) — find a branch for this company
      const matchingBranch = await Branch.findOne({
        companyId: dept.companyId,
        status: "Active",
      });

      if (!matchingBranch) {
        // Try inactive too
        const anyBranch = await Branch.findOne({ companyId: dept.companyId });
        if (!anyBranch) {
          results.noBranchFound.push({
            deptId: dept._id,
            deptName: dept.name,
            companyId: dept.companyId,
          });
          continue;
        }
        dept.branchId = anyBranch._id;
      } else {
        dept.branchId = matchingBranch._id;
      }

      await dept.save();
      results.fixed++;
    } catch (err) {
      results.errors.push({
        deptId: dept._id,
        error: err.message,
      });
    }
  }

  return results;
};

// Run directly if executed as a script
if (process.argv[1].includes("fixDepartmentBranchIds")) {
  (async () => {
    try {
      await connectDB();
      console.log("🔄 Starting department branchId migration...");
      const results = await fixDepartmentBranchIds();
      console.log("✅ Migration complete:", JSON.stringify(results, null, 2));
      process.exit(0);
    } catch (err) {
      console.error("❌ Migration failed:", err);
      process.exit(1);
    }
  })();
}
