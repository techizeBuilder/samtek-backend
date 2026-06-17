import Meeting from '../models/Meeting.js';
import Lead from '../models/Lead.js';
import User from '../models/User.js';
import nodemailer from 'nodemailer';

const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || ''
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000
  });
};

/**
 * Send Meeting Schedule Email
 */
const sendMeetingInviteEmail = async ({ to, contactPerson, meetingDate, startTime, endTime, meetingType, venue, onlineMeetingUrl, purpose, remarks, assigneeName, companyName }) => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`[EMAIL SKIPPED] No SMTP config. Would send meeting invite to: ${to}`);
    return { skipped: true };
  }
  const transporter = createTransporter();
  const formattedDate = new Date(meetingDate).toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const locationInfo = meetingType === 'Online'
    ? `<p style="margin:0;"><strong>Meeting URL:</strong> <a href="${onlineMeetingUrl || '#'}" style="color:#1e40af;">${onlineMeetingUrl || 'Will be shared shortly'}</a></p>`
    : `<p style="margin:0;"><strong>Venue:</strong> ${venue || 'To be confirmed'}</p>`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e40af, #3b82f6); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">📅 Meeting Scheduled</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">${companyName}</p>
      </div>
      <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb;">
        <p style="color: #374151; font-size: 16px;">Dear <strong>${contactPerson}</strong>,</p>
        <p style="color: #6b7280; font-size: 14px;">We are pleased to inform you that a meeting has been scheduled with you. Here are the details:</p>

        <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <h3 style="color: #0369a1; margin: 0 0 16px; font-size: 16px;">Meeting Details</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr style="border-bottom: 1px solid #e0f2fe;">
              <td style="padding: 8px 4px; color: #64748b; width: 40%;"><strong>Date</strong></td>
              <td style="padding: 8px 4px; color: #1e293b;">${formattedDate}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e0f2fe;">
              <td style="padding: 8px 4px; color: #64748b;"><strong>Time</strong></td>
              <td style="padding: 8px 4px; color: #1e293b;">${startTime}${endTime ? ' – ' + endTime : ''}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e0f2fe;">
              <td style="padding: 8px 4px; color: #64748b;"><strong>Type</strong></td>
              <td style="padding: 8px 4px; color: #1e293b;">${meetingType === 'Online' ? '🌐 Online Meeting' : '🏢 In-Person Visit'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e0f2fe;">
              <td style="padding: 8px 4px; color: #64748b;"><strong>Purpose</strong></td>
              <td style="padding: 8px 4px; color: #1e293b;">${purpose || 'Sales'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e0f2fe;">
              <td style="padding: 8px 4px; color: #64748b;"><strong>Location</strong></td>
              <td style="padding: 8px 4px; color: #1e293b;">${locationInfo}</td>
            </tr>
            ${assigneeName ? `<tr>
              <td style="padding: 8px 4px; color: #64748b;"><strong>Your Contact</strong></td>
              <td style="padding: 8px 4px; color: #1e293b;">${assigneeName}</td>
            </tr>` : ''}
          </table>
        </div>

        ${remarks ? `<div style="background: #fefce8; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0; color: #92400e; font-size: 13px;"><strong>Note:</strong> ${remarks}</p>
        </div>` : ''}

        <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">If you have any questions, please feel free to reach out to us.</p>
        <p style="color: #374151; font-size: 14px;">Best regards,<br><strong>${companyName}</strong></p>
      </div>
      <p style="text-align: center; color: #9ca3af; font-size: 11px; margin-top: 16px;">This is an automated email from ${companyName} ERP System</p>
    </div>
  `;

  try {
    const result = await transporter.sendMail({
      messageId: `meeting-${Date.now()}@samtek`,
      from: `"${companyName}" <${process.env.SMTP_USER}>`,
      to,
      subject: `📅 Meeting Scheduled: ${formattedDate} at ${startTime} — ${companyName}`,
      html
    });
    console.log(`✅ Meeting invite sent to ${to}`);
    return result;
  } catch (err) {
    console.error(`❌ Failed to send meeting invite email:`, err.message);
    throw err;
  }
};

/**
 * Schedule / Update a Meeting for a Lead
 */
export const scheduleMeeting = async (req, res) => {
  try {
    const { id: leadId } = req.params;
    const {
      meetingType, meetingDate, startTime, endTime,
      assignedTo, meetingWith, purpose,
      venue, onlineMeetingUrl, remarks, sendInviteEmail
    } = req.body;

    if (!meetingDate || !startTime) {
      return res.status(400).json({ success: false, message: 'Meeting date and start time are required' });
    }

    const lead = await Lead.findOne({ _id: leadId, companyId: req.user.companyId });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    // Check if meeting already exists for this lead — update it
    let meeting = await Meeting.findOne({ leadId, companyId: req.user.companyId });
    const isUpdate = !!meeting;

    const meetingData = {
      leadId,
      companyId: req.user.companyId,
      meetingType: meetingType || 'Visit',
      meetingDate: new Date(meetingDate),
      startTime,
      endTime: endTime || '',
      assignedTo: assignedTo || req.user._id,
      meetingWith: meetingWith || lead.contactPerson,
      purpose: purpose || 'Sales',
      venue: meetingType === 'Visit' ? (venue || '') : '',
      onlineMeetingUrl: meetingType === 'Online' ? (onlineMeetingUrl || '') : '',
      remarks: remarks || '',
      sendInviteEmail: !!sendInviteEmail,
      createdBy: req.user._id
    };

    if (isUpdate) {
      Object.assign(meeting, meetingData);
      await meeting.save();
    } else {
      meeting = new Meeting(meetingData);
      await meeting.save();
    }

    // Populate assignedTo for response
    await meeting.populate('assignedTo', 'fullName username email');

    // Add history to lead
    lead.history = lead.history || [];
    lead.history.push({
      action: isUpdate ? 'Meeting Updated' : 'Meeting Scheduled',
      notes: `Meeting ${isUpdate ? 'updated' : 'scheduled'} for ${new Date(meetingDate).toLocaleDateString('en-IN')} at ${startTime}`,
      performedBy: req.user._id,
      timestamp: new Date()
    });
    await lead.save();

    // Send email if requested
    if (sendInviteEmail && lead.email) {
      try {
        // Get company name
        const Company = (await import('../models/Company.js')).default;
        const company = await Company.findById(req.user.companyId);
        const companyName = company?.name || 'Samtek Machinery';

        const assignee = meeting.assignedTo;
        const assigneeName = assignee?.fullName || assignee?.username || '';

        await sendMeetingInviteEmail({
          to: lead.email,
          contactPerson: lead.contactPerson,
          meetingDate,
          startTime,
          endTime,
          meetingType: meetingType || 'Visit',
          venue,
          onlineMeetingUrl,
          purpose,
          remarks,
          assigneeName,
          companyName
        });
      } catch (emailErr) {
        console.error('Meeting email send failed (non-fatal):', emailErr.message);
        // Non-fatal — meeting still saved
      }
    }

    res.status(isUpdate ? 200 : 201).json({
      success: true,
      message: `Meeting ${isUpdate ? 'updated' : 'scheduled'} successfully${sendInviteEmail && lead.email ? ' and invite sent' : ''}`,
      meeting
    });
  } catch (error) {
    console.error('Error scheduling meeting:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

/**
 * Get Meeting for a Lead (one meeting per lead)
 */
export const getMeeting = async (req, res) => {
  try {
    const { id: leadId } = req.params;
    const meeting = await Meeting.findOne({ leadId, companyId: req.user.companyId })
      .populate('assignedTo', 'fullName username email');
    res.json({ success: true, meeting: meeting || null });
  } catch (error) {
    console.error('Error fetching meeting:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};
