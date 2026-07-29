import { sendWhatsAppText, sendWhatsAppTemplate } from '../services/whatsappService.js';

// POST /api/whatsapp/send — every "Send via WhatsApp" button across the app
// (Leads, Accounts, Complaints/Service, Marketing) calls this same endpoint.
// Pass `template: { name, languageCode, variables }` to send an approved
// Template (works for any recipient, even a fresh lead); omit it to send
// free text (only works inside a customer's 24h reply window).
// On failure it returns a waMeUrl so the frontend can fall back to opening
// the WhatsApp app for a manual send instead of the request just failing.
export const sendMessage = async (req, res) => {
  try {
    const { to, message, template } = req.body;
    if (!to) {
      return res.status(400).json({ success: false, message: 'to is required' });
    }

    let result;
    if (template?.name) {
      result = await sendWhatsAppTemplate({
        companyId: req.user.companyId,
        to,
        templateName: template.name,
        languageCode: template.languageCode,
        variables: template.variables || []
      });
    } else {
      if (!message) {
        return res.status(400).json({ success: false, message: 'message is required (or pass template)' });
      }
      result = await sendWhatsAppText({ companyId: req.user.companyId, to, message });
    }

    if (!result.success) {
      return res.status(200).json({
        success: false,
        message: result.error,
        needsTemplate: result.needsTemplate || false,
        waMeUrl: result.waMeUrl
      });
    }

    res.json({ success: true, message: 'WhatsApp message sent', messageId: result.messageId });
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};
