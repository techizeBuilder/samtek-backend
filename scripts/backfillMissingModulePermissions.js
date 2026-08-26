import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// One-time fix-up: some existing users of these roles were created before their
// role had a corresponding "Module Permissions" entry in RolePermissionManagement.jsx,
// so their permissions.modules never got a matching module. Now that the Sidebar
// actually enforces module permissions for these roles instead of showing everything
// unconditionally, back-fill full default access so nobody loses navigation they
// already had. Only touches users who are missing the module entirely - never
// overwrites an existing one.
const ROLE_DEFAULT_MODULE = {
  'Company Admin': {
    name: 'hrms',
    features: ['dashboard', 'employeeManagement', 'myCompany', 'operatingUnits', 'departments', 'designations', 'rolePermissions', 'taskManagement'],
  },
  'HR-Admin': {
    name: 'hrms',
    features: ['dashboard', 'employeeManagement', 'myCompany', 'operatingUnits', 'departments', 'designations', 'rolePermissions', 'taskManagement'],
  },
  'Research & Development Head': {
    name: 'rnd',
    features: ['dashboard', 'inventory', 'approveRequests', 'productMaster', 'designApproval', 'bomManagement', 'toolProcess', 'prototype', 'changeManagement', 'qualityParameters', 'documentation', 'expenses', 'lms'],
  },
  'Complaint Management Head': {
    name: 'complaints',
    features: ['dashboard', 'supportManagement', 'technicians', 'customerRecords', 'dealVerifications', 'deliveryConfirmation', 'installationSchedule', 'feedbackRatings', 'expenses'],
  },
  'QC Head': {
    name: 'quality-control',
    features: ['dashboard', 'qcJobs', 'qcInspection', 'qcInward', 'lms'],
  },
  'Store Head': {
    name: 'Store',
    features: ['dashboard', 'orders', 'lms'],
  },
  'MIS Admin': {
    name: 'mis',
    features: ['dashboard', 'salesReport', 'financeReport', 'productionReport', 'inventoryReport', 'complaintReport', 'hrmsReport', 'qualityReport'],
  },
};

const buildModule = ({ name, features }) => ({
  name,
  dashboard: true,
  features: features.map((key) => ({ key, view: true, add: true, edit: true, delete: true })),
});

const run = async () => {
  const execute = process.argv.includes('--execute');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. Mode: ${execute ? 'EXECUTE (will write)' : 'DRY RUN (no writes)'}\n`);

  let totalUpdated = 0;

  for (const [role, moduleConfig] of Object.entries(ROLE_DEFAULT_MODULE)) {
    const users = await User.find({ role });
    const missing = users.filter(u => !(u.permissions?.modules || []).some(m => m.name === moduleConfig.name));

    if (missing.length === 0) {
      console.log(`${role}: nothing to backfill`);
      continue;
    }

    console.log(`${role}: backfilling ${missing.length} user(s) with '${moduleConfig.name}' module`);
    for (const user of missing) {
      console.log(`   - ${user.username} (${user.email})`);
      if (execute) {
        const existingModules = user.permissions?.modules || [];
        user.permissions = {
          role: user.permissions?.role || role.toLowerCase().replace(/ /g, '_'),
          unit: user.permissions?.unit || '',
          canAccessAllUnits: user.permissions?.canAccessAllUnits || false,
          modules: [...existingModules, buildModule(moduleConfig)],
        };
        await user.save();
        totalUpdated++;
      }
    }
  }

  console.log(execute ? `\nDone. Updated ${totalUpdated} user(s).` : '\nDry run complete. Re-run with --execute to apply.');
  await mongoose.disconnect();
  process.exit(0);
};

run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
