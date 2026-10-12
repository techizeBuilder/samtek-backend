// Cancelling a PO (procurement-v2 gap 13, 2026-10-09) — the two endpoints.
// The rules live in services/poCancellationService.js.
import Purchase from '../models/Purchase.js';
import {
  requestCancellation, applyCancellation, rejectCancellation, openCancellation,
} from '../services/poCancellationService.js';

// POST /api/accounts/purchases/orders/:id/cancel-request
// body: { reasons[], side: 'Vendor'|'Ours', note, closeRequests[] }
export const requestPoCancellation = async (req, res) => {
  try {
    const po = await Purchase.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!po) return res.status(404).json({ message: 'Purchase order not found' });
    const result = await requestCancellation(po, req.body, req.user, req);
    if (result.status) return res.status(result.status).json({ message: result.message });
    res.json({
      message: result.kind === 'Full'
        ? 'Cancellation sent to the Company Admin. The PO stays as it is until they approve.'
        : `Short close sent to the Company Admin — the ${result.lines} line${result.lines === 1 ? '' : 's'} not yet received. Store can still receive until it's approved.`,
    });
  } catch (error) {
    console.error('requestPoCancellation error:', error);
    res.status(500).json({ message: 'Could not send the cancellation request.' });
  }
};

// PUT /api/po-approvals/:id/cancel-review  body: { decision: 'approve'|'reject', remarks }
export const reviewPoCancellation = async (req, res) => {
  try {
    const { decision } = req.body;
    const remarks = String(req.body.remarks || '').trim();
    if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ message: 'decision must be approve or reject' });
    const po = await Purchase.findById(req.params.id);
    if (!po) return res.status(404).json({ message: 'Purchase order not found' });
    if (String(po.companyId) !== String(req.user.companyId) && req.user.role !== 'Super Admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const request = openCancellation(po);
    if (!request) return res.status(409).json({ message: 'There is no cancellation waiting on this PO.' });
    // Separation of duties — nobody approves a cancellation they asked for.
    if (String(request.requestedBy) === String(req.user._id)) {
      return res.status(403).json({ message: 'You can\'t review a cancellation you asked for yourself.' });
    }
    if (decision === 'reject') {
      if (!remarks) return res.status(400).json({ message: 'Give a reason for keeping the PO.' });
      await rejectCancellation(po, request, req.user, remarks, req);
      return res.json({ message: 'Refused — the PO stays as it is. Purchase has been notified.' });
    }
    const result = await applyCancellation(po, request, req.user, remarks, req);
    if (result.status) return res.status(result.status).json({ message: result.message });
    res.json({
      message: `${result.kind === 'Full' ? 'PO cancelled' : `Short closed — ${result.lines} line${result.lines === 1 ? '' : 's'} cancelled`}. ${result.invoiceNote}${result.emailSent ? ' The vendor has been emailed.' : ' The vendor was NOT emailed (no email address or email not set up) — tell them directly.'}`,
    });
  } catch (error) {
    console.error('reviewPoCancellation error:', error);
    res.status(500).json({ message: error.message || 'Could not review the cancellation.' });
  }
};
