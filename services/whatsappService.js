import ApiSettings from '../models/ApiSettings.js';

const GRAPH_API_VERSION = 'v21.0';

// Meta's error code for "outside the 24h customer-service window — a
// Template message is required instead of free text". Frontends use this
// flag to fall back to opening wa.me (which just opens the app for a human
// to send manually — no template restriction applies there).
const RE_ENGAGEMENT_ERROR_CODE = 131047;

const cleanPhone = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  // Indian 10-digit mobiles need the country code; anything already longer
  // (has a country code) is left as-is.
  return digits.length === 10 ? `91${digits}` : digits;
};

// Shared POST to Meta's /messages endpoint — used by both the free-text and
// template senders below. Never throws; always resolves to a result object.
const postToWhatsAppApi = async (settings, phone, payload, waMeUrl) => {
  try {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${settings.whatsapp.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.whatsapp.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, ...payload }),
      signal: AbortSignal.timeout(15000)
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      const errCode = data.error?.code;
      const errSubcode = data.error?.error_subcode;
      const needsTemplate = errCode === RE_ENGAGEMENT_ERROR_CODE || errSubcode === RE_ENGAGEMENT_ERROR_CODE;
      return {
        success: false,
        error: data.error?.message || `WhatsApp API error (HTTP ${response.status})`,
        needsTemplate,
        waMeUrl
      };
    }

    settings.whatsapp.lastSyncedAt = new Date();
    await settings.save();

    return { success: true, messageId: data.messages?.[0]?.id || null };
  } catch (err) {
    return { success: false, error: err.message, waMeUrl };
  }
};

/**
 * Send a free-text WhatsApp message via Meta's Cloud API.
 * Only succeeds if the recipient has messaged this business number within
 * the last 24 hours — otherwise Meta rejects it (needs an approved
 * Template instead). Callers should fall back to a wa.me link on failure.
 *
 * Returns { success, error, needsTemplate, waMeUrl } — never throws.
 */
export const sendWhatsAppText = async ({ companyId, to, message }) => {
  const phone = cleanPhone(to);
  const waMeUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message || '')}` : null;

  if (!phone) {
    return { success: false, error: 'No valid phone number provided', waMeUrl: null };
  }

  const settings = await ApiSettings.findOne({ companyId });
  if (!settings?.whatsapp?.enabled || !settings.whatsapp.phoneNumberId || !settings.whatsapp.accessToken) {
    return { success: false, error: 'WhatsApp API not configured (Admin Settings → WhatsApp)', waMeUrl };
  }

  return postToWhatsAppApi(settings, phone, { type: 'text', text: { body: message || '' } }, waMeUrl);
};

/**
 * Send an approved WhatsApp message Template — works for ANY recipient,
 * even one who has never messaged this business number before (unlike
 * sendWhatsAppText, no 24h window needed). `variables` fills the template's
 * {{1}}, {{2}}... body placeholders in order, as plain strings.
 *
 * Returns { success, error, waMeUrl } — never throws.
 */
export const sendWhatsAppTemplate = async ({ companyId, to, templateName, languageCode = 'en', variables = [] }) => {
  const phone = cleanPhone(to);
  // No text pre-fill on the fallback — wa.me can't reproduce a template's
  // filled-in variables, so on failure this just opens a blank chat with
  // the customer for a manual message instead.
  const waMeUrl = phone ? `https://wa.me/${phone}` : null;

  if (!phone) {
    return { success: false, error: 'No valid phone number provided', waMeUrl: null };
  }
  if (!templateName) {
    return { success: false, error: 'No template name provided', waMeUrl };
  }

  const settings = await ApiSettings.findOne({ companyId });
  if (!settings?.whatsapp?.enabled || !settings.whatsapp.phoneNumberId || !settings.whatsapp.accessToken) {
    return { success: false, error: 'WhatsApp API not configured (Admin Settings → WhatsApp)', waMeUrl };
  }

  const payload = {
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(variables.length ? {
        components: [{
          type: 'body',
          parameters: variables.map(v => ({ type: 'text', text: String(v ?? '') }))
        }]
      } : {})
    }
  };

  return postToWhatsAppApi(settings, phone, payload, waMeUrl);
};
