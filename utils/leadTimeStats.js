import ItemLeadTimeStats from '../models/ItemLeadTimeStats.js';

// First WARMUP_SAMPLES completions use a plain running mean (so one noisy
// first data point doesn't swing the average wildly); after that, switch to
// an exponential moving average so the number tracks recent/current
// throughput instead of being dragged down by old history. Both are O(1)
// updates — no raw history is ever stored or scanned.
const WARMUP_SAMPLES = 10;
const EMA_ALPHA = 0.25;

// Best-effort by design: callers wrap this in try/catch and must never let
// a stats-update failure block the real action (order completion, purchase
// receipt) that triggered it.
export async function recordLeadTimeSample(companyId, itemCode, itemName, pathType, durationDays) {
  if (!companyId || !itemCode || !Number.isFinite(durationDays) || durationDays < 0) return;

  const existing = await ItemLeadTimeStats.findOne({ company: companyId, itemCode, pathType });

  if (!existing) {
    await ItemLeadTimeStats.create({
      company: companyId,
      itemCode,
      itemName: itemName || '',
      pathType,
      avgLeadDays: durationDays,
      sampleCount: 1,
      lastUpdatedAt: new Date(),
    });
    return;
  }

  const nextCount = existing.sampleCount + 1;
  const nextAvg = nextCount <= WARMUP_SAMPLES
    ? existing.avgLeadDays + (durationDays - existing.avgLeadDays) / nextCount
    : existing.avgLeadDays + EMA_ALPHA * (durationDays - existing.avgLeadDays);

  existing.avgLeadDays = Math.max(0, nextAvg);
  existing.sampleCount = nextCount;
  if (itemName) existing.itemName = itemName;
  existing.lastUpdatedAt = new Date();
  await existing.save();
}
