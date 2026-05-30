import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

/**
 * Multi-purpose email sender for Task Management
 * @param {Object} params 
 * @param {string} params.to - Recipient email
 * @param {string} params.userName - Name of the recipient
 * @param {string} params.subject - Email Subject line
 * @param {string} params.title - Big Header Title inside the email
 * @param {string} params.message - The main paragraph message
 * @param {Object} [params.taskDetails] - Optional task object (title, type, priority, status, dueDate)
 */
export const sendTaskEmail = async ({
    to,
    userName,
    subject,
    title,
    message,
    taskDetails = null
}) => {
    try {
        // Dynamically build the Task Details box if data is provided
        let taskDetailsHtml = '';

        if (taskDetails) {
            const formattedDate = taskDetails.dueDate
                ? new Date(taskDetails.dueDate).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                : 'N/A';

            const priorityColor = taskDetails.priority === 'High' ? '#dc2626' : taskDetails.priority === 'Medium' ? '#d97706' : '#2563eb';

            taskDetailsHtml = `
                <div style="background-color: #f9fafb; padding: 15px; border-radius: 6px; margin: 20px 0; border: 1px solid #e5e7eb;">
                    <h3 style="margin-top: 0; color: #111827; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px;">Task Summary</h3>
                    <p style="margin: 0 0 10px 0;"><strong>Title:</strong> ${taskDetails.title || 'N/A'}</p>
                    ${taskDetails.type ? `<p style="margin: 0 0 10px 0;"><strong>Type:</strong> ${taskDetails.type}</p>` : ''}
                    ${taskDetails.status ? `<p style="margin: 0 0 10px 0;"><strong>Status:</strong> ${taskDetails.status}</p>` : ''}
                    ${taskDetails.priority ? `
                        <p style="margin: 0 0 10px 0;"><strong>Priority:</strong> 
                            <span style="color: ${priorityColor}; font-weight: bold;">
                                ${taskDetails.priority}
                            </span>
                        </p>` : ''
                }
                    <p style="margin: 0;"><strong>Due Date:</strong> ${formattedDate}</p>
                </div>
            `;
        }

        const mailOptions = {
            from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_USER}>`,
            to: to,
            subject: subject,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                    <div style="background-color: #4f46e5; padding: 20px; text-align: center; color: white;">
                        <h2 style="margin: 0;">${title}</h2>
                    </div>
                    <div style="padding: 20px; color: #374151;">
                        <p>Hello <strong>${userName}</strong>,</p>
                        <p>${message}</p>
                        
                        ${taskDetailsHtml}
                        
                        <p>Please log in to the ERP system to view the full details and attachments.</p>
                        
                        <div style="margin-top: 30px; text-align: center;">
                            <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/hrms/Employee/tasks" style="background-color: #4f46e5; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; display: inline-block;">View in Portal</a>
                        </div>
                    </div>
                    <div style="background-color: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #6b7280;">
                        <p style="margin: 0;">This is an automated message from ${process.env.SMTP_FROM_NAME}. Please do not reply.</p>
                    </div>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`✉️ Email sent to ${to}: ${info.messageId}`);
        return true;
    } catch (error) {
        console.error('❌ Error sending task email:', error.message);
        return false;
    }
};