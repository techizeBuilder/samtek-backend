// R&D's Make / Buy switch for a Child Part or Sub Child Part (2026-10-28,
// docs/make-or-buy-parts-2026-10.md) — the logic is services/makeBuyService.js.
import { switchMakeBuy, MakeBuyError } from '../services/makeBuyService.js';

// PUT /api/rd/parts/:id/make-buy  body: { mode: 'make' | 'buy' }
export const switchPartMakeBuy = async (req, res) => {
  try {
    const item = await switchMakeBuy(req.params.id, req.user.companyId, req.body?.mode, req.user);
    res.json({ success: true, data: item, message: `${item.code} is now ${item.purchase ? 'bought from a vendor' : 'made here'}.` });
  } catch (err) {
    if (err instanceof MakeBuyError) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};
