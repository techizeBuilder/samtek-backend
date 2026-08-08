import fs from 'fs';
import { DEPARTMENTS, getDeptMailer } from '../config/mailAccounts.js';

const cleanupFiles = (files = []) => {
  files.forEach((file) => {
    fs.unlink(file.path, () => {});
  });
};

const buildHtml = (message) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 20px;">
    <div style="background: white; padding: 24px; border-radius: 12px; border: 1px solid #e5e7eb; white-space: pre-wrap; color: #374151; font-size: 14px; line-height: 1.6;">${message}</div>
  </div>
`;

// Best-effort activity log on the record the email was sent from (e.g. a Lead).
// Never allowed to fail the email send itself.
const logToRef = async ({ refModel, refId, to, subject, userId }) => {
  if (!refModel || !refId) return;
  try {
    if (refModel === 'Lead') {
      const Lead = (await import('../models/Lead.js')).default;
      await Lead.findByIdAndUpdate(refId, {
        $push: {
          history: {
            action: 'Email Sent',
            notes: `Email sent to ${to}. Subject: ${subject}`,
            performedBy: userId,
            timestamp: new Date(),
          },
        },
      });
    }
  } catch (error) {
    console.error('⚠️ Failed to log email to ref record:', error.message);
  }
};

export const sendGenericEmail = async (req, res) => {
  const files = req.files || [];
  try {
    const { to, subject, message, department, refModel, refId } = req.body;

    if (!to || !subject || !department) {
      cleanupFiles(files);
      return res.status(400).json({ success: false, message: 'to, subject and department are required' });
    }

    if (!Object.values(DEPARTMENTS).includes(department)) {
      cleanupFiles(files);
      return res.status(400).json({ success: false, message: 'Invalid department' });
    }

    const mailer = await getDeptMailer(department);
    if (!mailer) {
      cleanupFiles(files);
      return res.status(400).json({
        success: false,
        message: `${department} department ki email Admin ne set nahi ki hai. Admin Settings > SMTP Settings me set karwayen.`,
      });
    }

    const { transporter, fromAddress } = mailer;
    const attachments = files.map((file) => ({
      filename: file.originalname,
      path: file.path,
    }));

    const result = await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      html: buildHtml(message || ''),
      attachments,
    });

    cleanupFiles(files);
    await logToRef({ refModel, refId, to, subject, userId: req.user?._id });

    console.log(`✅ Email sent to ${to} from ${department} mailbox. MessageId: ${result.messageId}`);
    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    cleanupFiles(files);
    console.error('❌ Error in sendGenericEmail:', error.message);
    res.status(500).json({ success: false, message: 'Failed to send email', error: error.message });
  }
};
