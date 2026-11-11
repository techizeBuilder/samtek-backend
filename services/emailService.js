import { DEPARTMENTS, getDeptMailer, mailboxMissingMessage } from '../config/mailAccounts.js';
import { formatDims } from './fabricationDemandService.js';

// Fabrication Master items only — read-only "this order covers ..." block
// for vendor-facing emails (RFQ invite + winning-bid confirmation). The
// vendor always bids/pays against the single combined quantity shown
// separately — this is context only, never a distinct line to quote against.
function fabricationBreakdownHtml(lines) {
  if (!lines || lines.length === 0) return '';
  const rows = lines.map(l => `
    <tr style="border-top: 1px solid #e0e7ff;">
      <td style="padding: 4px 0; color: #6b7280; font-size: 13px;">${formatDims(l.values)} × ${l.quantity}</td>
      <td style="padding: 4px 0; color: #111827; text-align: right;">${l.lineWeightKg != null ? `${l.lineWeightKg} kg` : ''}</td>
    </tr>`).join('');
  return `
    <div style="background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px; padding: 14px; margin: 14px 0;">
      <p style="color: #57534e; font-size: 12px; font-weight: bold; margin: 0 0 6px; text-transform: uppercase;">This order covers</p>
      <table style="width: 100%; border-collapse: collapse;">${rows}</table>
    </div>`;
}

/**
 * Send Cash Access OTP Email to the Company Admin.
 * Second factor for viewing a customer's Cash Amount (see cashAccessController).
 * NOTE: unlike the other senders below, this THROWS on failure — the caller
 * must know the OTP never reached the admin (no silent {success:false}).
 */
export const sendOtpEmail = async ({ to, otp, requestedByName, customerName }) => {
  const mailer = await getDeptMailer(DEPARTMENTS.CASH_ACCESS);
  if (!mailer) {
    throw new Error(mailboxMissingMessage(DEPARTMENTS.CASH_ACCESS));
  }
  const { transporter, fromAddress } = mailer;
  const subject = `🔐 Cash Access OTP: ${otp} — approval requested`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 20px;">
      <div style="background: #b91c1c; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">🔐 Cash Access Request</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">One-Time Password required</p>
      </div>

      <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb;">
        <p style="color: #374151; font-size: 16px;">Dear Company Admin,</p>
        <p style="color: #6b7280; line-height: 1.6;">
          <strong>${requestedByName || 'An Accounts user'}</strong> has entered the correct Cash Password and is
          requesting to view the <strong>Cash Amount</strong> of customer <strong>${customerName || 'N/A'}</strong>.
        </p>

        <div style="background: #fef2f2; border: 2px dashed #b91c1c; border-radius: 10px; padding: 22px; margin: 24px 0; text-align: center;">
          <p style="color: #6b7280; font-size: 13px; margin: 0 0 8px;">Share this OTP with them ONLY if you approve:</p>
          <p style="color: #b91c1c; font-size: 34px; font-weight: bold; letter-spacing: 10px; margin: 0;">${otp}</p>
          <p style="color: #9ca3af; font-size: 12px; margin: 10px 0 0;">Valid for 10 minutes</p>
        </div>

        <p style="color: #6b7280; font-size: 13px;">
          If you did not expect this request, do NOT share the OTP — the cash amount stays hidden without it.
        </p>
      </div>
    </div>
  `;

  const result = await transporter.sendMail({
    from: `"Cash Access Security" <${fromAddress}>`,
    to,
    subject,
    html
  });
  console.log(`✅ Cash Access OTP email sent to ${to}. MessageId: ${result.messageId}`);
  return { success: true, messageId: result.messageId };
};

/**
 * Send Payment Reminder Email to Customer
 */
export const sendPaymentReminderEmail = async ({ to, customerName, invoiceNo, totalAmount, paidAmount, balanceAmount, dueDate, companyName, daysOverdue }) => {
  const mailer = await getDeptMailer(DEPARTMENTS.ACCOUNTS);
  if (!mailer) {
    console.log(`[EMAIL SKIPPED] Accounts SMTP not configured. Would send reminder to: ${to}`);
    return { success: false, skipped: true, error: mailboxMissingMessage(DEPARTMENTS.ACCOUNTS) };
  }
  const { transporter, fromAddress } = mailer;
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
      : `This is a friendly reminder that you have a pending payment for Invoice <strong>${invoiceNo}</strong>.`
    }
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
    const result = await transporter.sendMail({
      from: `"${companyName}" <${fromAddress}>`,
      to,
      subject,
      html
    });
    console.log(`✅ Email sent to ${to} for invoice ${invoiceNo}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`❌ Email failed to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send Quotation Email to Customer with PDF Attachment
 */
export const sendQuotationEmail = async ({ to, customerName, leadCode, companyName, attachmentBase64 }) => {
  const mailer = await getDeptMailer(DEPARTMENTS.SALES);
  if (!mailer) {
    console.log(`[EMAIL SKIPPED] Sales SMTP not configured. Would send quotation to: ${to}`);
    return { success: false, skipped: true, error: mailboxMissingMessage(DEPARTMENTS.SALES) };
  }
  const { transporter, fromAddress } = mailer;
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

    const result = await transporter.sendMail({
      from: `"${companyName}" <${fromAddress}>`,
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
  } catch (error) {
    console.error(`❌ Quotation Email FAILED for ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

// HTML-escape anything typed by a person (vendor charge names, term text,
// remarks) before it goes into an email body.
const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (n) => `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN')}`;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const td = 'padding: 8px; border: 1px solid #e5e7eb;';

/**
 * Send a Purchase Order to the vendor (procurement-v2, 2026-10-08). Since
 * 2026-10-29 (client) the PO itself is the attached PDF — the same document
 * Purchase downloads to send on WhatsApp (services/purchaseOrderPdf.js) — and
 * the email is a short cover note: PO number, grand total, delivery, "quote
 * the PO number on your invoice". Sent automatically when a PO becomes a real
 * order (created directly, or approved by the Company Admin), and by the
 * "Send / Resend PO email" button.
 *
 * Returns { success, error, notConfigured } — when the Purchase mailbox isn't
 * set up nothing is sent and success is FALSE (it used to report a mock
 * success, which wrongly marked the PO as "Sent").
 */
export const sendPurchaseOrderEmail = async ({ mailer: givenMailer, to, vendorName, companyName, purchase, pdf }) => {
  const poNumber = purchase.purchaseOrderNumber;
  const mailer = givenMailer || await getDeptMailer(DEPARTMENTS.PURCHASE);
  if (!mailer) {
    console.log(`[EMAIL SKIPPED] Purchase SMTP not configured. Would send PO ${poNumber} to: ${to}`);
    return { success: false, notConfigured: true, error: mailboxMissingMessage(DEPARTMENTS.PURCHASE) };
  }
  const { transporter, fromAddress } = mailer;
  const subject = `🛒 Purchase Order ${poNumber} from ${companyName}`;

  const lines = (purchase.items || []).filter(l => !l.cancelled?.at);
  const onAdvance = purchase.deliveryClock?.startsOn === 'advance' && !purchase.deliveryClock?.startedAt;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; background: #f9fafb; padding: 20px;">
      <div style="background: #1e40af; padding: 22px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 20px;">🛒 Purchase Order ${esc(poNumber)}</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 6px 0 0; font-size: 14px;">${esc(companyName)} · ${day(purchase.orderDate || purchase.createdAt)}</p>
      </div>
      <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb;">
        <p style="color: #374151; font-size: 15px;">Dear <strong>${esc(vendorName)}</strong>,</p>
        <p style="color: #4b5563; line-height: 1.6;">Please find our purchase order <strong>${esc(poNumber)}</strong> attached (PDF) — ${lines.length} item${lines.length === 1 ? '' : 's'}, grand total <strong>${money(purchase.grandTotal)}</strong>. Please confirm receipt and deliver as per the ${onAdvance ? 'delivery times in the PO — they count from the day we pay the advance' : 'dates in the PO'}.</p>
        <p style="color: #374151; font-size: 13px; margin: 10px 0;"><strong>Deliver to:</strong> ${esc(purchase.deliveryAddress || '')}</p>
        <p style="color: #6b7280; font-size: 13px; margin-top: 18px;">Please quote PO number <strong>${esc(poNumber)}</strong> on your invoice and delivery challan.</p>
        <p style="color: #111827; font-weight: bold;">— ${esc(companyName)} Procurement Team</p>
      </div>
    </div>`;
  const attachments = pdf ? [{ filename: `${poNumber}.pdf`, content: pdf, contentType: 'application/pdf' }] : [];

  try {
    const result = await transporter.sendMail({ from: `"${companyName} Procurement" <${fromAddress}>`, to, subject, html, attachments });
    console.log(`✅ PO Email sent to ${to} for PO ${poNumber}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`❌ PO Email failed to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * The vendor's daily QC results for one PO (client, 2026-10-29;
 * services/qcVendorEmailService.js): accepted material, material not accepted
 * (QC's reason — our Purchase team settles it with them), what's still to
 * come, and on the last day "all passed" with the payment due date. No
 * amounts otherwise.
 * accepted / notAccepted: [{ itemName, size, qty, unit, replacement?, reason? }]
 * pending: [{ itemName, standing: 'to come' | 'with QC' }]
 * allPassed: null | { balance, dueDate, creditDays }
 */
export const sendQcResultEmail = async ({ mailer: givenMailer, to, vendorName, companyName, poNumber, accepted = [], notAccepted = [], pending = [], allPassed = null, attachments = [], morePhotos = 0 }) => {
  const mailer = givenMailer || await getDeptMailer(DEPARTMENTS.PURCHASE);
  if (!mailer) return { success: false, notConfigured: true, error: mailboxMissingMessage(DEPARTMENTS.PURCHASE) };
  const { transporter, fromAddress } = mailer;
  const subject = allPassed
    ? `✅ PO ${poNumber}: all material passed our quality check — ${companyName}`
    : `PO ${poNumber}: quality check results — ${companyName}`;
  const what = (r) => `<strong>${esc(r.itemName)}</strong>${r.size ? ` <span style="color:#6b7280;">(${esc(r.size)})</span>` : ''}`;
  const qty = (r) => `${r.qty} ${esc(r.unit || '')}`.trim();
  const row = (cells) => `<tr>${cells.map(c => `<td style="${td}">${c}</td>`).join('')}</tr>`;
  const acceptedHtml = accepted.length ? `
        <p style="color:#166534; font-weight:bold; margin:18px 0 6px;">✅ Accepted</p>
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          ${accepted.map(r => row([`${what(r)}${r.replacement ? ' <span style="color:#6b7280;">— replacement</span>' : ''}`, qty(r)])).join('')}
        </table>` : '';
  const notAcceptedHtml = notAccepted.length ? `
        <p style="color:#b91c1c; font-weight:bold; margin:18px 0 6px;">❌ Not accepted</p>
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          ${notAccepted.map(r => row([
            what(r) + ((r.failedChecks || []).length ? `<div style="color:#b91c1c;font-size:12px;margin-top:4px;">Failed: ${r.failedChecks.map(esc).join('; ')}</div>` : ''),
            qty(r),
            esc(r.reason || 'Did not meet our quality check'),
          ])).join('')}
        </table>
        ${attachments.length ? `<p style="color:#374151; font-size:13px; margin:6px 0 0;">Photos of the material not accepted are attached (${attachments.length})${morePhotos ? ` — ${morePhotos} more with our Purchase team` : ''}.</p>` : ''}
        <p style="color:#6b7280; font-size:13px; margin:6px 0 0;">Our Purchase team will contact you about the material not accepted.</p>` : '';
  const pendingHtml = !allPassed && pending.length ? `
        <p style="color:#374151; font-weight:bold; margin:18px 0 6px;">Still to come / being checked on this PO</p>
        <ul style="color:#374151; margin:0; padding-left:18px; line-height:1.7; font-size:13px;">
          ${pending.map(p => `<li>${esc(p.itemName)} — ${p.standing === 'with QC' ? 'received, being checked' : 'not received yet'}</li>`).join('')}
        </ul>` : '';
  const allPassedHtml = allPassed ? `
        <div style="background:#f0fdf4; border-left:4px solid #16a34a; border-radius:4px; padding:14px 18px; margin:18px 0 0;">
          <p style="color:#166534; font-weight:bold; margin:0;">All material on PO ${esc(poNumber)} has passed our quality check.</p>
          ${allPassed.balance > 0 ? `<p style="color:#374151; margin:6px 0 0;">${allPassed.creditDays ? `Payment is due by <strong>${day(allPassed.dueDate)}</strong> (${allPassed.creditDays} credit days).` : 'Payment will now be processed.'}</p>` : ''}
        </div>` : '';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; background: #f9fafb; padding: 20px;">
      <div style="background: #1e40af; padding: 22px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 20px;">Quality check results</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 6px 0 0; font-size: 14px;">PO ${esc(poNumber)} · ${esc(companyName)}</p>
      </div>
      <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb;">
        <p style="color: #374151; font-size: 15px;">Dear <strong>${esc(vendorName)}</strong>,</p>
        <p style="color: #4b5563;">Our quality check has been done on material you supplied against PO <strong>${esc(poNumber)}</strong>:</p>
        ${acceptedHtml}${notAcceptedHtml}${pendingHtml}${allPassedHtml}
        <p style="color: #111827; font-weight: bold; margin-top: 22px;">— ${esc(companyName)} Procurement Team</p>
      </div>
    </div>`;
  try {
    const result = await transporter.sendMail({ from: `"${companyName} Procurement" <${fromAddress}>`, to, subject, html, attachments });
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`❌ QC results email failed to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Tells the vendor a PO is cancelled (gap 13, 2026-10-09) — the whole PO, or
 * (short close) only the items still to be delivered. `lines` = the
 * cancelled lines { itemName, quantity, purchaseUnit }.
 */
export const sendPurchaseOrderCancellationEmail = async ({ to, vendorName, companyName, poNumber, full, lines = [], reason = '' }) => {
  const mailer = await getDeptMailer(DEPARTMENTS.PURCHASE);
  if (!mailer) {
    console.log(`[EMAIL SKIPPED] Purchase SMTP not configured. Would send the cancellation of PO ${poNumber} to: ${to}`);
    return { success: false, notConfigured: true, error: mailboxMissingMessage(DEPARTMENTS.PURCHASE) };
  }
  const { transporter, fromAddress } = mailer;
  const subject = full
    ? `❌ Purchase Order ${poNumber} cancelled — ${companyName}`
    : `Purchase Order ${poNumber}: remaining items cancelled — ${companyName}`;
  const rows = lines.map(l => `<li>${esc(l.itemName || 'Item')} — ${esc(String(l.quantity ?? ''))} ${esc(l.purchaseUnit || '')}</li>`).join('');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; background: #f9fafb; padding: 20px;">
      <div style="background: white; border-radius: 8px; padding: 26px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <h2 style="color:#b91c1c; margin:0 0 14px;">${full ? 'Purchase Order cancelled' : 'Remaining items cancelled'}</h2>
        <p style="color:#374151;">Dear <strong>${esc(vendorName || 'Vendor')}</strong>,</p>
        <p style="color:#374151;">
          ${full
            ? `Our Purchase Order <strong>${esc(poNumber)}</strong> is <strong>cancelled</strong>. Please do not dispatch anything against it.`
            : `On our Purchase Order <strong>${esc(poNumber)}</strong>, the items below are <strong>cancelled</strong> — please do not dispatch them. What you have already delivered stays as it is.`}
        </p>
        ${rows ? `<ul style="color:#374151; line-height:1.8;">${rows}</ul>` : ''}
        ${reason ? `<p style="color:#374151; font-size:13px;"><strong>Reason:</strong> ${esc(reason)}</p>` : ''}
        <p style="color:#6b7280; font-size:13px; margin-top:18px;">If you have any questions, please reply to this email quoting PO <strong>${esc(poNumber)}</strong>.</p>
        <p style="color:#111827; font-weight:bold;">— ${esc(companyName)} Procurement Team</p>
      </div>
    </div>`;
  try {
    const result = await transporter.sendMail({ from: `"${companyName} Procurement" <${fromAddress}>`, to, subject, html });
    console.log(`✅ PO cancellation email sent to ${to} for PO ${poNumber}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`❌ PO cancellation email failed to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * One quotation request for SEVERAL items to one vendor (procurement-v2,
 * 2026-10-08) — replaces one-email-per-item. The link opens the vendor's
 * multi-item quotation page (/vendor-quotation/:token), where they price
 * every item and add their charges and payment terms.
 */
// reminder = true (point 16, 2026-10-10): the same request and link sent
// again, marked as a reminder — Purchase's "Send reminder" button.
export const sendQuotationRequestEmail = async ({ mailer, to, vendorName, requestNo, items, link, expiresAt, companyName, validityDays = null, reminder = false }) => {
  const resolvedMailer = mailer || await getDeptMailer(DEPARTMENTS.PURCHASE);
  if (!resolvedMailer) {
    console.log(`[EMAIL SKIPPED] Purchase SMTP not configured. Would send quotation request ${requestNo} to: ${to}`);
    return { success: false, error: mailboxMissingMessage(DEPARTMENTS.PURCHASE) };
  }
  const { transporter, fromAddress } = resolvedMailer;
  const subject = `${reminder ? 'Reminder: ' : ''}📋 Request for Quotation ${requestNo} — ${items.length} item${items.length === 1 ? '' : 's'} | ${companyName}`;

  const rows = items.map((it, i) => `
        <tr>
          <td style="${td}">${i + 1}</td>
          <td style="${td}">${esc(it.itemName)}${it.itemCode ? ` <span style="color:#6b7280;font-size:12px;">(${esc(it.itemCode)})</span>` : ''}
            ${(it.fabricationDimensionLines || []).length ? `<div style="color:#6b7280;font-size:12px;margin-top:4px;">${(it.fabricationDimensionLines || []).map(l => `${formatDims(l.values)} × ${l.quantity}`).join('<br/>')}</div>` : ''}
          </td>
          <td style="${td} text-align:center;">${it.quantity} ${esc(it.purchaseUnit || '')}</td>
        </tr>`).join('');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; background: #f9fafb; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e40af, #7c3aed); padding: 28px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">📋 Request for Quotation</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">${esc(companyName)} · ${esc(requestNo)}</p>
      </div>
      <div style="background: white; padding: 28px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb;">
        <p style="color: #374151; font-size: 15px;">Dear <strong>${esc(vendorName)}</strong>,</p>
        ${reminder ? `<p style="color: #92400e; background:#fff7ed; border:1px solid #fed7aa; border-radius:6px; padding:10px 12px; font-size: 14px;">A friendly reminder: we haven't received your quotation for <strong>${esc(requestNo)}</strong> yet. The same link below still works.</p>` : ''}
        <p style="color: #6b7280; line-height: 1.6;">Please send us your best quotation for the items below — all of them on one page.</p>

        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin: 16px 0;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="${td} text-align:left;">#</th>
              <th style="${td} text-align:left;">Item</th>
              <th style="${td} text-align:center;">Quantity</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <p style="color: #374151; font-weight: bold; font-size: 14px;">On the quotation page, please give:</p>
        <ul style="color: #6b7280; line-height: 1.9; margin: 0 0 18px; padding-left: 20px; font-size: 13px;">
          <li>Price per unit, GST % and whether your price includes GST — for each item</li>
          <li>Delivery time (days) and warranty, if any</li>
          <li>Any charges (freight, packing…) and your payment terms</li>
          <li>Leave an item blank if you can't supply it</li>
          ${validityDays ? `<li>Your prices will be treated as valid for <strong>${Number(validityDays)} days</strong> from the day you submit</li>` : ''}
        </ul>

        <div style="text-align: center; margin: 26px 0;">
          <a href="${link}" style="display: inline-block; background: linear-gradient(135deg, #1e40af, #7c3aed); color: white; text-decoration: none; padding: 14px 34px; border-radius: 8px; font-weight: bold; font-size: 16px;">
            📝 Submit Your Quotation
          </a>
        </div>

        <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 6px; padding: 12px;">
          <p style="color: #92400e; font-size: 13px; margin: 0;">⏰ This link is valid until <strong>${day(expiresAt)}</strong>. You can submit once — please check everything before submitting.</p>
        </div>

        <p style="color: #6b7280; font-size: 13px; margin-top: 22px;">Thank you for your partnership.</p>
        <p style="color: #111827; font-weight: bold;">— ${esc(companyName)} Procurement Team</p>
      </div>
    </div>`;

  try {
    const result = await transporter.sendMail({ from: `"${companyName} Procurement" <${fromAddress}>`, to, subject, html });
    console.log(`✅ Quotation request ${requestNo} emailed to ${to}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`❌ Quotation request email failed to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send RFQ (Request for Quotation) Email to Vendor
 */
export const sendRFQEmail = async ({ mailer, to, vendorName, rfqNo, productName, quantity, quantityUnit, fabricationDimensionLines, requiredByDate, bidLink, companyName, notes }) => {
  // A caller sending to several vendors at once (createRFQ) looks up the
  // Purchase mailbox once and passes it in here for every vendor, instead of
  // this function re-querying GlobalSmtpSettings + rebuilding a transporter
  // per vendor. Callers that only ever send one RFQ email (resend) can omit
  // it and let this function resolve it itself.
  const resolvedMailer = mailer || await getDeptMailer(DEPARTMENTS.PURCHASE);
  if (!resolvedMailer) {
    console.log(`[EMAIL SKIPPED] Purchase SMTP not configured. Would send RFQ ${rfqNo} to: ${to}`);
    return { success: false, error: mailboxMissingMessage(DEPARTMENTS.PURCHASE) };
  }
  const { transporter, fromAddress } = resolvedMailer;
  const subject = `📋 Request for Quotation: ${rfqNo} — ${productName} | ${companyName}`;

  const formattedDate = requiredByDate
    ? new Date(requiredByDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'As Soon As Possible';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; background: #f9fafb; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e40af, #7c3aed); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">📋 Request for Quotation</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">${companyName} · ${rfqNo}</p>
      </div>

      <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb;">
        <p style="color: #374151; font-size: 16px;">Dear <strong>${vendorName}</strong>,</p>
        <p style="color: #6b7280; line-height: 1.6;">
          We are inviting you to participate in our procurement process. Please review the below requirement and submit your best quotation.
        </p>

        <div style="background: #f0f4ff; border-left: 4px solid #1e40af; border-radius: 4px; padding: 20px; margin: 20px 0;">
          <h3 style="color: #1e40af; margin: 0 0 12px;">📦 Requirement Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #6b7280; font-size: 14px; width: 40%;">RFQ Number</td>
              <td style="padding: 6px 0; color: #111827; font-weight: bold;">${rfqNo}</td>
            </tr>
            <tr style="border-top: 1px solid #e0e7ff;">
              <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Product / Item</td>
              <td style="padding: 6px 0; color: #111827; font-weight: bold;">${productName}</td>
            </tr>
            <tr style="border-top: 1px solid #e0e7ff;">
              <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Required Quantity</td>
              <td style="padding: 6px 0; color: #111827; font-weight: bold;">${quantity} ${quantityUnit || 'Unit(s)'}</td>
            </tr>
            <tr style="border-top: 1px solid #e0e7ff;">
              <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Required By</td>
              <td style="padding: 6px 0; color: #dc2626; font-weight: bold;">${formattedDate}</td>
            </tr>
            ${notes ? `
            <tr style="border-top: 1px solid #e0e7ff;">
              <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Additional Notes</td>
              <td style="padding: 6px 0; color: #374151;">${notes}</td>
            </tr>` : ''}
          </table>
        </div>

        ${fabricationBreakdownHtml(fabricationDimensionLines)}

        <p style="color: #374151; font-weight: bold; font-size: 15px;">Please submit your quotation including:</p>
        <ul style="color: #6b7280; line-height: 2; margin: 0 0 20px; padding-left: 20px;">
          <li>Unit Price (₹ per unit)</li>
          <li>Delivery Time (in days)</li>
          ${fabricationDimensionLines?.length ? '' : '<li>Warranty Period (in months)</li>'}
          <li>Any additional remarks</li>
        </ul>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${bidLink}" style="
            display: inline-block;
            background: linear-gradient(135deg, #1e40af, #7c3aed);
            color: white;
            text-decoration: none;
            padding: 14px 36px;
            border-radius: 8px;
            font-weight: bold;
            font-size: 16px;
            letter-spacing: 0.5px;
          ">
            📝 Submit Your Quotation
          </a>
        </div>

        <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 6px; padding: 14px; margin-top: 20px;">
          <p style="color: #92400e; font-size: 13px; margin: 0;">
            ⏰ <strong>Note:</strong> This quotation link is valid for 7 days. If you have any questions, please contact us directly.
          </p>
        </div>

        <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">Thank you for your partnership.</p>
        <p style="color: #111827; font-weight: bold;">— ${companyName} Procurement Team</p>
      </div>
    </div>
  `;

  try {
    const result = await transporter.sendMail({
      from: `"${companyName} Procurement" <${fromAddress}>`,
      to,
      subject,
      html
    });
    console.log(`✅ RFQ Email sent to ${to} for ${rfqNo}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`❌ RFQ Email failed to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send Purchase Exchange request email — QC rejected some qty of a
 * Purchase-sourced item and we're asking the vendor to replace it.
 */
export const sendPurchaseExchangeEmail = async ({ to, vendorName, itemName, exchangeQty, purchaseUnit, reason, poNumber, acceptLink, companyName }) => {
  const mailer = await getDeptMailer(DEPARTMENTS.PURCHASE);
  if (!mailer) {
    console.log(`[EMAIL SKIPPED] Purchase SMTP not configured. Would send Purchase Exchange request to: ${to}`);
    return { success: true, mocked: true, message: 'No SMTP config, mock success' };
  }
  const { transporter, fromAddress } = mailer;
  const subject = `🔄 Replacement Requested: ${itemName} | ${companyName}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; background: #f9fafb; padding: 20px;">
      <div style="background: linear-gradient(135deg, #b91c1c, #7c3aed); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">🔄 Purchase Exchange Request</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">${companyName}${poNumber ? ' · PO ' + poNumber : ''}</p>
      </div>

      <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb;">
        <p style="color: #374151; font-size: 16px;">Dear <strong>${vendorName}</strong>,</p>
        <p style="color: #6b7280; line-height: 1.6;">
          During Quality Control inspection, part of a recent shipment did not pass inspection. We request a replacement for the quantity below.
        </p>

        <div style="background: #fef2f2; border-left: 4px solid #b91c1c; border-radius: 4px; padding: 20px; margin: 20px 0;">
          <h3 style="color: #b91c1c; margin: 0 0 12px;">📦 Replacement Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #6b7280; font-size: 14px; width: 40%;">Item</td>
              <td style="padding: 6px 0; color: #111827; font-weight: bold;">${itemName}</td>
            </tr>
            <tr style="border-top: 1px solid #fecaca;">
              <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Quantity to Replace</td>
              <td style="padding: 6px 0; color: #111827; font-weight: bold;">${exchangeQty} ${purchaseUnit || 'Unit(s)'}</td>
            </tr>
            ${reason ? `
            <tr style="border-top: 1px solid #fecaca;">
              <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">QC Rejection Reason</td>
              <td style="padding: 6px 0; color: #374151;">${reason}</td>
            </tr>` : ''}
          </table>
        </div>

        <p style="color: #374151; line-height: 1.6;">
          Please click below to confirm you can send a replacement. Once confirmed, our Store team will expect the replacement shipment.
        </p>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${acceptLink}" style="
            display: inline-block;
            background: linear-gradient(135deg, #b91c1c, #7c3aed);
            color: white;
            text-decoration: none;
            padding: 14px 36px;
            border-radius: 8px;
            font-weight: bold;
            font-size: 16px;
            letter-spacing: 0.5px;
          ">
            ✅ Confirm Replacement
          </a>
        </div>

        <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 6px; padding: 14px; margin-top: 20px;">
          <p style="color: #92400e; font-size: 13px; margin: 0;">
            ⏰ <strong>Note:</strong> This link is valid for 7 days. If you have any questions, please contact us directly.
          </p>
        </div>

        <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">Thank you for your partnership.</p>
        <p style="color: #111827; font-weight: bold;">— ${companyName} Procurement Team</p>
      </div>
    </div>
  `;

  try {
    const result = await transporter.sendMail({
      from: `"${companyName} Procurement" <${fromAddress}>`,
      to,
      subject,
      html
    });
    console.log(`✅ Purchase Exchange email sent to ${to} for ${itemName}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`❌ Purchase Exchange email failed to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send Vendor Bid Confirmation Email (when vendor is selected as winner)
 */
export const sendVendorBidConfirmationEmail = async ({ to, vendorName, rfqNo, poNumber, productName, quantity, fabricationDimensionLines, unitPrice, deliveryDays, warrantyMonths, companyName }) => {
  const mailer = await getDeptMailer(DEPARTMENTS.PURCHASE);
  if (!mailer) {
    console.log(`[EMAIL SKIPPED] Purchase SMTP not configured. Would send confirmation to: ${to}`);
    return { success: true, mocked: true };
  }
  const { transporter, fromAddress } = mailer;
  const subject = `🎉 Congratulations! Your Quotation Selected — PO ${poNumber} | ${companyName}`;
  const totalValue = (unitPrice * quantity * 1.18).toLocaleString('en-IN', { maximumFractionDigits: 0 });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; background: #f9fafb; padding: 20px;">
      <div style="background: linear-gradient(135deg, #065f46, #047857); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">🎉 Quotation Confirmed!</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">${companyName} · PO: ${poNumber}</p>
      </div>

      <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb;">
        <p style="color: #374151; font-size: 16px;">Dear <strong>${vendorName}</strong>,</p>
        <p style="color: #6b7280; line-height: 1.6;">
          We are pleased to inform you that your quotation for <strong>${rfqNo}</strong> has been selected.
          A Purchase Order has been generated in your name. Please proceed with the delivery as per the agreed terms.
        </p>

        <div style="background: #f0fdf4; border-left: 4px solid #16a34a; border-radius: 4px; padding: 20px; margin: 20px 0;">
          <h3 style="color: #15803d; margin: 0 0 12px;">📄 Purchase Order Summary</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 7px 0; color: #6b7280; font-size: 14px; width: 45%;">Purchase Order No.</td>
              <td style="padding: 7px 0; color: #111827; font-weight: bold;">${poNumber}</td>
            </tr>
            <tr style="border-top: 1px solid #dcfce7;">
              <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">RFQ Reference</td>
              <td style="padding: 7px 0; color: #111827;">${rfqNo}</td>
            </tr>
            <tr style="border-top: 1px solid #dcfce7;">
              <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Product / Item</td>
              <td style="padding: 7px 0; color: #111827; font-weight: bold;">${productName}</td>
            </tr>
            <tr style="border-top: 1px solid #dcfce7;">
              <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Quantity</td>
              <td style="padding: 7px 0; color: #111827; font-weight: bold;">${quantity} Unit(s)</td>
            </tr>
            <tr style="border-top: 1px solid #dcfce7;">
              <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Unit Price</td>
              <td style="padding: 7px 0; color: #111827; font-weight: bold;">₹${Number(unitPrice).toLocaleString('en-IN')}</td>
            </tr>
            <tr style="border-top: 1px solid #dcfce7;">
              <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Order Value (incl. GST)</td>
              <td style="padding: 7px 0; color: #15803d; font-size: 17px; font-weight: bold;">₹${totalValue}</td>
            </tr>
            <tr style="border-top: 1px solid #dcfce7;">
              <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Delivery Expected Within</td>
              <td style="padding: 7px 0; color: #dc2626; font-weight: bold;">${deliveryDays} Days</td>
            </tr>
            ${fabricationDimensionLines?.length ? '' : `
            <tr style="border-top: 1px solid #dcfce7;">
              <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Warranty Period</td>
              <td style="padding: 7px 0; color: #111827;">${warrantyMonths} Month(s)</td>
            </tr>`}
          </table>
        </div>

        ${fabricationBreakdownHtml(fabricationDimensionLines)}

        <p style="color: #374151; font-weight: bold;">Important Instructions:</p>
        <ul style="color: #6b7280; line-height: 2; padding-left: 20px;">
          <li>Please deliver within <strong>${deliveryDays} days</strong> as quoted</li>
          ${fabricationDimensionLines?.length ? '' : '<li>Include warranty card / documentation with delivery</li>'}
          <li>Mention PO Number <strong>${poNumber}</strong> on all dispatch documents</li>
          <li>Contact us immediately if any delivery delays are anticipated</li>
        </ul>

        <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">Thank you for your competitive pricing and timely response.</p>
        <p style="color: #111827; font-weight: bold;">— ${companyName} Procurement Team</p>
      </div>
    </div>
  `;

  try {
    const result = await transporter.sendMail({
      from: `"${companyName} Procurement" <${fromAddress}>`,
      to,
      subject,
      html
    });
    console.log(`✅ Bid Confirmation Email sent to ${to}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`❌ Bid Confirmation Email failed to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};
