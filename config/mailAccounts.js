import nodemailer from 'nodemailer';
import GlobalSmtpSettings from '../models/GlobalSmtpSettings.js';

/**
 * Department-wise SMTP mailboxes, configured platform-wide by Super Admin in
 * Admin Settings > SMTP Settings (GlobalSmtpSettings.smtp, one entry per
 * department). Shared by every company — there is exactly one mailbox per
 * department across the whole platform.
 */
export const DEPARTMENTS = {
  SALES: 'SALES',
  ACCOUNTS: 'ACCOUNTS',
  PURCHASE: 'PURCHASE',
  HR: 'HR',
  INFO: 'INFO',
  CASH_ACCESS: 'CASH_ACCESS',
};

const findDeptConfig = async (department) => {
  const settings = await GlobalSmtpSettings.findOne({}, { smtp: 1 }).lean();
  if (!settings) return null;
  return (settings.smtp || []).find(s => s.department === department && s.isActive) || null;
};

/**
 * Resolves a department's mailbox and returns a ready-to-use transporter +
 * its "from" address, or null if that department's SMTP hasn't been
 * configured yet in Admin Settings.
 */
export const getDeptMailer = async (department) => {
  const config = await findDeptConfig(department);
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
