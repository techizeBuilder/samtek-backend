"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPurchaseOrderEmail = exports.sendQuotationEmail = exports.sendPaymentReminderEmail = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
/**
 * Create a reusable email transporter
 * Gmail ya koi bhi SMTP use kar sakte ho — .env se config hoga
 */
const createTransporter = () => {
    return nodemailer_1.default.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false,
        auth: {
            user: process.env.SMTP_USER || '',
            pass: process.env.SMTP_PASS || ''
        },
        // Adding timeouts to prevent hanging
        connectionTimeout: 10000, // 10 seconds
        greetingTimeout: 10000,
        socketTimeout: 30000, // 30 seconds
    });
};
/**
 * Send Payment Reminder Email to Customer
 */
const sendPaymentReminderEmail = (_a) => __awaiter(void 0, [_a], void 0, function* ({ to, customerName, invoiceNo, totalAmount, paidAmount, balanceAmount, dueDate, companyName, daysOverdue }) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.log(`[EMAIL SKIPPED] No SMTP config. Would send reminder to: ${to}`);
        return { skipped: true, reason: 'No SMTP config' };
    }
    const transporter = createTransporter();
    const isOverdue = daysOverdue > 0;
    const subject = isOverdue
        ? `⚠️ OVERDUE Payment Reminder — Invoice ${invoiceNo} (${daysOverdue} days overdue)`
        : `💳 Payment Reminder — Invoice ${invoiceNo} from ${companyName}`;
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 20px;">
      <div style="background: ${isOverdue ? '#dc2626' : '#1e40af'}; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">
          ${isOverdue ? '⚠️ Payment Overdue' : '💳 Payment Reminder'}
        </h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">${companyName}</p>
      </div>

      <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb;">
        <p style="color: #374151; font-size: 16px;">Dear <strong>${customerName}</strong>,</p>
        <p style="color: #6b7280;">
          ${isOverdue
        ? `This is an urgent reminder that your payment for Invoice <strong>${invoiceNo}</strong> is <strong>${daysOverdue} days overdue</strong>. Please clear the outstanding balance immediately.`
        : `This is a friendly reminder that you have a pending payment for Invoice <strong>${invoiceNo}</strong>.`}
        </p>

        <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Invoice No</td>
              <td style="padding: 8px 0; color: #111827; font-weight: bold; text-align: right;">${invoiceNo}</td>
            </tr>
            <tr style="border-top: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Invoice Amount</td>
              <td style="padding: 8px 0; color: #111827; font-weight: bold; text-align: right;">₹${totalAmount.toLocaleString('en-IN')}</td>
            </tr>
            <tr style="border-top: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Amount Paid</td>
              <td style="padding: 8px 0; color: #16a34a; font-weight: bold; text-align: right;">₹${paidAmount.toLocaleString('en-IN')}</td>
            </tr>
            <tr style="border-top: 2px solid #e5e7eb;">
              <td style="padding: 12px 0 8px; color: #111827; font-size: 16px; font-weight: bold;">Balance Due</td>
              <td style="padding: 12px 0 8px; color: ${isOverdue ? '#dc2626' : '#1e40af'}; font-size: 20px; font-weight: bold; text-align: right;">₹${balanceAmount.toLocaleString('en-IN')}</td>
            </tr>
            <tr style="border-top: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Due Date</td>
              <td style="padding: 8px 0; color: ${isOverdue ? '#dc2626' : '#111827'}; font-weight: bold; text-align: right;">${new Date(dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
            </tr>
          </table>
        </div>

        ${isOverdue ? `<div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; border-radius: 4px; margin-bottom: 24px;">
          <p style="color: #dc2626; font-weight: bold; margin: 0;">⚠️ This account is ${daysOverdue} days past due date. Please make payment immediately to avoid further action.</p>
        </div>` : ''}

        <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
          If you have already made the payment, please ignore this email. For any queries, contact us directly.
        </p>
        <p style="color: #6b7280; font-size: 13px;">Thank you for your business.</p>
        <p style="color: #111827; font-weight: bold;">— ${companyName}</p>
      </div>
    </div>
    `;
    try {
        const result = yield transporter.sendMail({
            from: `"${companyName}" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html
        });
        console.log(`✅ Email sent to ${to} for invoice ${invoiceNo}`);
        return { success: true, messageId: result.messageId };
    }
    catch (error) {
        console.error(`❌ Email failed to ${to}:`, error.message);
        return { success: false, error: error.message };
    }
});
exports.sendPaymentReminderEmail = sendPaymentReminderEmail;
/**
 * Send Quotation Email to Customer with PDF Attachment
 */
const sendQuotationEmail = (_a) => __awaiter(void 0, [_a], void 0, function* ({ to, customerName, leadCode, companyName, attachmentBase64 }) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.log(`[EMAIL SKIPPED] No SMTP config. Would send quotation to: ${to}`);
        return { skipped: true, reason: 'No SMTP config' };
    }
    const transporter = createTransporter();
    const subject = `📄 Quotation from ${companyName} — Lead #${leadCode}`;
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 20px;">
      <div style="background: #2563eb; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">New Quotation</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">${companyName}</p>
      </div>

      <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb;">
        <p style="color: #374151; font-size: 16px;">Dear <strong>${customerName}</strong>,</p>
        <p style="color: #6b7280;">
          Please find attached the quotation for your requirement (Lead #${leadCode}). 
          We have carefully reviewed your needs and prepared a professional proposal for your consideration.
        </p>

        <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; border-radius: 4px; margin: 24px 0;">
          <p style="color: #1e40af; font-weight: bold; margin: 0;">What's inside?</p>
          <p style="color: #1e40af; margin: 4px 0 0; font-size: 13px;">Itemized pricing, technical specifications, and terms of service.</p>
        </div>

        <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
          Should you have any questions or require further clarification, please do not hesitate to contact our sales team.
        </p>
        <p style="color: #6b7280; font-size: 13px;">Best regards,</p>
        <p style="color: #111827; font-weight: bold;">— ${companyName} Team</p>
      </div>
    </div>
    `;
    try {
        console.log(`📤 Attempting to send quotation email to ${to} for lead ${leadCode}...`);
        const base64Data = attachmentBase64.split("base64,")[1];
        if (base64Data) {
            const sizeInMB = (base64Data.length * 0.75) / (1024 * 1024);
            console.log(`📎 Attachment size: ~${sizeInMB.toFixed(2)} MB`);
        }
        const result = yield transporter.sendMail({
            from: `"${companyName}" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html,
            attachments: [
                {
                    filename: `Quotation_${leadCode}.pdf`,
                    content: base64Data,
                    encoding: 'base64'
                }
            ]
        });
        console.log(`✅ Quotation Email sent successfully to ${to}. MessageId: ${result.messageId}`);
        return { success: true, messageId: result.messageId };
    }
    catch (error) {
        console.error(`❌ Quotation Email FAILED for ${to}:`, error.message);
        return { success: false, error: error.message };
    }
});
exports.sendQuotationEmail = sendQuotationEmail;
/**
 * Send Purchase Order Email to Vendor
 */
const sendPurchaseOrderEmail = (_a) => __awaiter(void 0, [_a], void 0, function* ({ to, vendorName, poNumber, items, grandTotal, companyName }) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.log(`[EMAIL SKIPPED] No SMTP config. Would send PO ${poNumber} to: ${to}`);
        return { success: true, mocked: true, message: 'No SMTP config, mock success' };
    }
    const transporter = createTransporter();
    const subject = `🛒 New Purchase Order ${poNumber} from ${companyName}`;
    const itemsRows = items.map(item => `
        <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${item.itemName}</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right;">₹${item.unitPrice.toLocaleString('en-IN')}</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right;">₹${(item.quantity * item.unitPrice).toLocaleString('en-IN')}</td>
        </tr>
    `).join('');
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 20px;">
      <div style="background: #1e40af; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">🛒 New Purchase Order</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">${companyName}</p>
      </div>

      <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb;">
        <p style="color: #374151; font-size: 16px;">Dear <strong>${vendorName}</strong>,</p>
        <p style="color: #6b7280;">
          We are pleased to place the following Purchase Order (PO Number: <strong>${poNumber}</strong>) with you. 
          Please review the items and prepare the shipment as per our agreement.
        </p>

        <div style="margin: 24px 0;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <thead>
              <tr style="background: #f3f4f6;">
                <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Item Name</th>
                <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: center;">Qty</th>
                <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: right;">Unit Price</th>
                <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: right;">Total Price</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows}
              <tr style="font-weight: bold; background: #f9fafb;">
                <td colSpan="3" style="padding: 8px; border: 1px solid #e5e7eb; text-align: right;">Grand Total:</td>
                <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; color: #1e40af; font-size: 16px;">₹${grandTotal.toLocaleString('en-IN')}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
          Please confirm receipt of this order and share the expected delivery date.
        </p>
        <p style="color: #6b7280; font-size: 13px;">Thank you for your cooperation.</p>
        <p style="color: #111827; font-weight: bold;">— ${companyName}</p>
      </div>
    </div>
    `;
    try {
        const result = yield transporter.sendMail({
            from: `"${companyName}" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html
        });
        console.log(`✅ PO Email sent to ${to} for PO ${poNumber}`);
        return { success: true, messageId: result.messageId };
    }
    catch (error) {
        console.error(`❌ PO Email failed to ${to}:`, error.message);
        return { success: false, error: error.message };
    }
});
exports.sendPurchaseOrderEmail = sendPurchaseOrderEmail;
