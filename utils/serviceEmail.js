import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_PORT == 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Reusable base layout for all emails
const generateEmailHTML = (title, content) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <div style="text-align: center; border-bottom: 2px solid #f3f4f6; padding-bottom: 15px; margin-bottom: 20px;">
            <h2 style="color: #4f46e5; margin: 0;">${process.env.SMTP_FROM_NAME} Support</h2>
        </div>
        ${content}
        <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #f3f4f6; text-align: center; color: #9ca3af; font-size: 11px;">
            <p>This is an automated system message. Please do not reply directly to this email.</p>
            <p>&copy; ${new Date().getFullYear()} ${process.env.SMTP_FROM_NAME}. All rights reserved.</p>
        </div>
    </div>
`;

/**
 * Universal function to send support emails based on the 'type'
 * TYPES: 'CREATED', 'ASSIGNED_CUSTOMER', 'ASSIGNED_TECH', 'VERIFICATION', 'CLOSED', 'CANCELLED', 'SLA_BREACH'
 */
export const sendSupportEmail = async ({ type, to, name, data }) => {
    if (!to) return; // Fail silently if no email is provided

    let subject = '';
    let content = '';

    switch (type) {
        case 'CREATED':
            subject = `Ticket Created: Support Request Received [${data.ticketId}]`;
            content = `
                <p style="color: #374151; font-size: 16px;">Dear <strong>${name}</strong>,</p>
                <p style="color: #4b5563; line-height: 1.6;">We have successfully registered your service request. Our team will review it and assign a technician shortly.</p>
                <ul style="color: #4b5563; line-height: 1.6; background-color: #f9fafb; padding: 15px 15px 15px 35px; border-radius: 8px;">
                    <li><strong>Ticket ID:</strong> <span style="color: #4f46e5; font-weight: bold;">${data.ticketId}</span></li>
                    <li><strong>Machine:</strong> ${data.machineType}</li>
                    <li><strong>Issue:</strong> ${data.issueType}</li>
                </ul>
            `;
            break;

        case 'ASSIGNED_CUSTOMER':
            subject = `Technician Assigned to Your Ticket [${data.ticketId}]`;
            content = `
                <p style="color: #374151; font-size: 16px;">Dear <strong>${name}</strong>,</p>
                <p style="color: #4b5563; line-height: 1.6;">A service technician has been assigned to your ticket <strong>${data.ticketId}</strong> and will be visiting your location soon.</p>
                <div style="background-color: #eff6ff; padding: 15px; border-radius: 8px; border-left: 4px solid #3b82f6;">
                    <p style="margin: 0 0 5px 0;"><strong>Technician:</strong> ${data.techName}</p>
                    <p style="margin: 0;"><strong>Contact:</strong> ${data.techContact}</p>
                </div>
            `;
            break;

        case 'ASSIGNED_TECH':
            subject = `New Ticket Assignment: [${data.ticketId}]`;
            content = `
                <p style="color: #374151; font-size: 16px;">Hello <strong>${name}</strong>,</p>
                <p style="color: #4b5563; line-height: 1.6;">You have been assigned a new service ticket. Please check your mobile app to start the visit.</p>
                <ul style="color: #4b5563; line-height: 1.6; background-color: #f9fafb; padding: 15px 15px 15px 35px; border-radius: 8px;">
                    <li><strong>Ticket ID:</strong> <span style="color: #4f46e5; font-weight: bold;">${data.ticketId}</span></li>
                    <li><strong>Customer:</strong> ${data.customerName}</li>
                    <li><strong>Location:</strong> ${data.address}</li>
                    <li><strong>Deadline:</strong> ${new Date(data.deadline).toLocaleString()}</li>
                </ul>
            `;
            break;

        case 'VERIFICATION':
            subject = `Action Required: Verify Service Resolution for [${data.ticketId}]`;
            content = `
                <p style="color: #374151; font-size: 16px;">Dear <strong>${name}</strong>,</p>
                <p style="color: #4b5563; line-height: 1.6;">Our technician has marked your service ticket <strong>${data.ticketId}</strong> as resolved. We kindly ask you to verify if the work was completed to your satisfaction.</p>
                <div style="text-align: center; margin: 35px 0;">
                    <a href="${data.link}" style="background-color: #4f46e5; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Verify Resolution Now</a>
                </div>
                <p style="color: #6b7280; font-size: 12px; text-align: center;"><em>Note: This secure link will expire in 48 hours.</em></p>
            `;
            break;

        case 'CLOSED':
            subject = `Ticket Closed Successfully [${data.ticketId}]`;
            content = `
                <p style="color: #374151; font-size: 16px;">Dear <strong>${name}</strong>,</p>
                <p style="color: #4b5563; line-height: 1.6;">Thank you for verifying the resolution! Your service ticket <strong>${data.ticketId}</strong> has been officially closed.</p>
                <p style="color: #4b5563; line-height: 1.6;">We appreciate your business. If you face any other issues, feel free to contact us.</p>
            `;
            break;

        case 'CANCELLED':
            subject = `Notice: Ticket Cancelled [${data.ticketId}]`;
            content = `
                <p style="color: #374151; font-size: 16px;">Dear <strong>${name}</strong>,</p>
                <p style="color: #4b5563; line-height: 1.6;">Your service ticket <strong>${data.ticketId}</strong> has been cancelled by our support team.</p>
                <div style="background-color: #fef2f2; padding: 15px; border-radius: 8px; border-left: 4px solid #ef4444;">
                    <p style="margin: 0; color: #991b1b;"><strong>Reason:</strong> ${data.reason || 'Administrative Cancellation'}</p>
                </div>
            `;
            break;

        case 'SLA_BREACH':
            subject = `🚨 URGENT: SLA Breached on Ticket [${data.ticketId}]`;
            content = `
                <p style="color: #374151; font-size: 16px;">Hello <strong>${name}</strong>,</p>
                <p style="color: #4b5563; line-height: 1.6;">A service ticket has breached its resolution deadline and requires immediate attention.</p>
                <ul style="color: #4b5563; line-height: 1.6; background-color: #fef2f2; padding: 15px 15px 15px 35px; border-radius: 8px;">
                    <li><strong>Ticket ID:</strong> <span style="color: #ef4444; font-weight: bold;">${data.ticketId}</span></li>
                    <li><strong>Priority:</strong> ${data.priority}</li>
                    <li><strong>Technician:</strong> ${data.techName || 'Unassigned'}</li>
                </ul>
            `;
            break;

        default:
            return;
    }

    const mailOptions = {
        from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_USER}>`,
        to,
        subject,
        html: generateEmailHTML(subject, content)
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Email [${type}] sent to ${to}`);
        return info;
    } catch (error) {
        // We catch and log the error but DO NOT throw it. 
        // We don't want a failed email to crash the ticket creation/assignment process!
        console.error(`❌ Error sending [${type}] email to ${to}:`, error.message);
    }
};