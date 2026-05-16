import User from '../models/User.js';

export const seedQCUser = async () => {
  const email = 'qchead@gmail.com';
  const password = '123456';

  // Find a user with companyId to copy the company assignment
  const refUser = await User.findOne({ companyId: { $exists: true, $ne: null } }).lean();
  if (!refUser) return { success: false, message: 'No reference user with companyId found' };

  // Remove existing QC user if any
  await User.deleteOne({ email });

  // Pass plain password — pre-save hook in User model handles hashing
  const user = await User.create({
    username: 'qchead',
    email,
    password,
    fullName: 'QC Head',
    role: 'QC Head',
    isActive: true,
    companyId: refUser.companyId,
    permissions: {
      role: 'qc_head',
      canAccessAllUnits: false,
      modules: [
        {
          name: 'quality-control',
          dashboard: true,
          features: [
            { key: 'dashboard', view: true, add: false, edit: false, delete: false, alter: false },
            { key: 'qcJobs', view: true, add: true, edit: true, delete: true, alter: true },
            { key: 'inwardEntry', view: true, add: true, edit: true, delete: false, alter: false },
            { key: 'inspection', view: true, add: true, edit: true, delete: false, alter: true },
            { key: 'reports', view: true, add: false, edit: false, delete: false, alter: false },
          ],
        },
      ],
    },
  });

  return {
    success: true,
    message: 'QC Head user created successfully',
    credentials: { email, password },
    companyId: refUser.companyId,
    userId: user._id,
  };
};
