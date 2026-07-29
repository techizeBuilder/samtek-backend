import nodemailer from 'nodemailer';
import AdminSettings from '../models/AdminSettings.js';

/**
 * Department-wise SMTP mailboxes, configured per-company in the Admin
 * Settings > SMTP Settings screen (AdminSettings.smtp, one entry per
 * department). Each entry carries its own real mailbox + password.
 */
export const DEPARTMENTS = {
  SALES: 'SALES',
  ACCOUNTS: 'ACCOUNTS',
  PURCHASE: 'PURCHASE',
  HR: 'HR',
  INFO: 'INFO',
  CASH_ACCESS: 'CASH_ACCESS',
};

const findDeptConfig = async (companyId, department) => {
  if (!companyId) return null;
  const settings = await AdminSettings.findOne({ companyId }, { smtp: 1 }).lean();
  if (!settings) return null;
  return (settings.smtp || []).find(s => s.department === department && s.isActive) || null;
};

/**
 * Resolves a department's mailbox for a company and returns a ready-to-use
 * transporter + its "from" address, or null if that department's SMTP
 * hasn't been configured yet in Admin Settings.
 */
export const getDeptMailer = async (companyId, department) => {
  const config = await findDeptConfig(companyId, department);
  if (!config || !config.email || !config.password) return null;

  const transporter = nodemailer.createTransport({
    host: config.mailServer,
    port: config.port,
    secure: config.port === 465, // true only for port 465, STARTTLS otherwise
    auth: { user: config.email, pass: config.password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });

  return { transporter, fromAddress: config.email };
};
