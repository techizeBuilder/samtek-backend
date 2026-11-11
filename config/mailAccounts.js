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

export const DEPARTMENT_LABELS = {
  SALES: 'Sales',
  ACCOUNTS: 'Accounts',
  PURCHASE: 'Purchase',
  HR: 'HR',
  INFO: 'Info (support)',
  CASH_ACCESS: 'Cash Access',
};

// The one message for "this department has no mailbox" (2026-10-29) — every
// email that can't go because of it says this, so people know whom to ask.
export const mailboxMissingMessage = (department) =>
  `The ${DEPARTMENT_LABELS[department] || department} email isn't set up yet. Ask your Super Admin to set it in Admin Settings → SMTP Settings.`;

// For an action that sends an email on the side (a meeting, a task, a ticket):
// the action is saved either way; this is the warning for the reply when the
// department's mailbox is missing, else null.
export const mailboxWarning = async (department) => (await getDeptMailer(department) ? null : mailboxMissingMessage(department));

// Who hears that an AUTOMATIC email couldn't go (no one is on screen for it).
const DEPARTMENT_HEADS = {
  SALES: ['Sales Head'],
  ACCOUNTS: ['Accounts Head'],
  PURCHASE: ['Accounts Head'],
  HR: ['HR-Admin'],
  INFO: ['Complaint Management Head'],
  CASH_ACCESS: ['Company Admin'],
};
const reported = new Map(); // `${dept}|${companyId}` → day already told

// An automatic email (cron / after an approval) couldn't go because the
// department has no mailbox → one bell per department per company per day
// to the department's head. `what` = e.g. "QC results to vendors". Never throws.
export async function reportMissingMailbox(department, { companyId = null, what = 'Emails' } = {}) {
  try {
    if (!companyId) return;
    const day = new Date().toDateString();
    const key = `${department}|${companyId}`;
    if (reported.get(key) === day) return;
    reported.set(key, day);
    const { default: notificationService } = await import('../services/notificationService.js');
    await notificationService.notifyRoles(DEPARTMENT_HEADS[department] || ['Company Admin'], {
      title: `${DEPARTMENT_LABELS[department] || department} email not set up`,
      message: `${what} couldn't be sent. ${mailboxMissingMessage(department)}`,
      type: 'system',
      priority: 'high',
      targetCompanyId: companyId,
      data: { mailboxMissing: department },
    });
  } catch (err) {
    console.error('Reporting a missing mailbox failed:', err.message);
  }
}

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
