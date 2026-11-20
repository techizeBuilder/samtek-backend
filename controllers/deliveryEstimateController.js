// Delivery estimate for Sales (rebuilt 18 Nov 2026; the old RDBOM / lead-time
// estimator is retired). docs/delivery-estimate/01-logic.md and 02-plan.md.
//   GET  /api/delivery-estimate/items?search=&page=   what Sales can pick
//   POST /api/delivery-estimate/estimate              { items: [{ itemId, qty }], travelDays }
//   PUT  /api/delivery-estimate/leads/:id             "Use this date" (save on the lead)
//   GET/PUT /api/delivery-estimate/settings           the Company Admin's numbers (read: Sales too)
import { EstimateError, estimateSettings, saveEstimateSettings } from '../services/estimate/numbers.js';
import { estimateQuote, estimableItems, saveOnLead } from '../services/estimate/estimateService.js';

const fail = (res, err) => {
  if (err instanceof EstimateError) return res.status(err.status).json({ success: false, message: err.message });
  console.error('[DeliveryEstimate]', err);
  return res.status(500).json({ success: false, message: err.message });
};

export const listEstimableItems = async (req, res) => {
  try { res.json({ success: true, ...(await estimableItems(req.user.companyId, req.query)) }); } catch (err) { fail(res, err); }
};

export const postEstimate = async (req, res) => {
  try { res.json({ success: true, data: await estimateQuote(req.user.companyId, req.body || {}) }); } catch (err) { fail(res, err); }
};

export const putLeadEstimate = async (req, res) => {
  try { res.json({ success: true, data: await saveOnLead(req.user, req.params.id, req.body || {}) }); } catch (err) { fail(res, err); }
};

export const getSettings = async (req, res) => {
  try { res.json({ success: true, data: await estimateSettings(req.user.companyId) }); } catch (err) { fail(res, err); }
};

export const putSettings = async (req, res) => {
  try { res.json({ success: true, data: await saveEstimateSettings(req.user, req.body || {}) }); } catch (err) { fail(res, err); }
};
