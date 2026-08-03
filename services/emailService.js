import { DEPARTMENTS, getDeptMailer } from '../config/mailAccounts.js';

/**
 * Send Cash Access OTP Email to the Company Admin.
 * Second factor for viewing a customer's Cash Amount (see cashAccessController).
 * NOTE: unlike the other senders below, this THROWS on failure — the caller
 * must know the OTP never reached the admin (no silent {success:false}).
 */
export const sendOtpEmail = async ({ to, otp, requestedByName, customerName }) => {
  const mailer = await getDeptMailer(DEPARTMENTS.CASH_ACCESS);
  if (!mailer) {
    throw new Error('Cash Access SMTP is not configured (Admin Settings > SMTP Settings)');
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
    return { success: false, skipped: true, error: 'Accounts email is not configured yet. Ask your Super Admin to set it up in Admin Settings > SMTP Settings.' };
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
    return { success: false, skipped: true, error: 'Sales email is not configured yet. Ask your Super Admin to set it up in Admin Settings > SMTP Settings.' };
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

/**
 * Send Purchase Order Email to Vendor
 */
export const sendPurchaseOrderEmail = async ({ to, vendorName, poNumber, items, grandTotal, companyName }) => {
  const mailer = await getDeptMailer(DEPARTMENTS.PURCHASE);
  if (!mailer) {
    console.log(`[EMAIL SKIPPED] Purchase SMTP not configured. Would send PO ${poNumber} to: ${to}`);
    return { success: true, mocked: true, message: 'No SMTP config, mock success' };
  }
  const { transporter, fromAddress } = mailer;
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
    const result = await transporter.sendMail({
      from: `"${companyName}" <${fromAddress}>`,
      to,
      subject,
      html
    });
    console.log(`✅ PO Email sent to ${to} for PO ${poNumber}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`❌ PO Email failed to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send RFQ (Request for Quotation) Email to Vendor
 */
export const sendRFQEmail = async ({ mailer, to, vendorName, rfqNo, productName, quantity, quantityUnit, requiredByDate, bidLink, companyName, notes }) => {
  // A caller sending to several vendors at once (createRFQ) looks up the
  // Purchase mailbox once and passes it in here for every vendor, instead of
  // this function re-querying GlobalSmtpSettings + rebuilding a transporter
  // per vendor. Callers that only ever send one RFQ email (resend) can omit
  // it and let this function resolve it itself.
  const resolvedMailer = mailer || await getDeptMailer(DEPARTMENTS.PURCHASE);
  if (!resolvedMailer) {
    console.log(`[EMAIL SKIPPED] Purchase SMTP not configured. Would send RFQ ${rfqNo} to: ${to}`);
    return { success: false, error: 'Purchase email is not configured yet. Ask your Super Admin to set it up in Admin Settings > SMTP Settings.' };
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

        <p style="color: #374151; font-weight: bold; font-size: 15px;">Please submit your quotation including:</p>
        <ul style="color: #6b7280; line-height: 2; margin: 0 0 20px; padding-left: 20px;">
          <li>Unit Price (₹ per unit)</li>
          <li>Delivery Time (in days)</li>
          <li>Warranty Period (in months)</li>
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
export const sendVendorBidConfirmationEmail = async ({ to, vendorName, rfqNo, poNumber, productName, quantity, unitPrice, deliveryDays, warrantyMonths, companyName }) => {
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
            <tr style="border-top: 1px solid #dcfce7;">
              <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Warranty Period</td>
              <td style="padding: 7px 0; color: #111827;">${warrantyMonths} Month(s)</td>
            </tr>
          </table>
        </div>

        <p style="color: #374151; font-weight: bold;">Important Instructions:</p>
        <ul style="color: #6b7280; line-height: 2; padding-left: 20px;">
          <li>Please deliver within <strong>${deliveryDays} days</strong> as quoted</li>
          <li>Include warranty card / documentation with delivery</li>
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
