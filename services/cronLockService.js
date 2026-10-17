import os from 'os';
import mongoose from 'mongoose';

// One run of a scheduled job at a time across EVERY server pointed at this
// database (2026-10-17, bug B1). Each backend registers its own node-cron, so
// with two servers on one database (a local backend + another copy) both
// sweeps fired in the same second and raced each other's "already raised?"
// check — PR035/PR036 and PR038/PR039 were raised 170 ms apart for the same
// size.
//
// A lease, not a held lock: the first server to claim `name` holds it for
// `leaseMs` and the others skip that run. It is never released early, so a
// server whose clock or start lags by a few seconds still sees it taken.
// Keep `leaseMs` shorter than the job's interval.
export async function withCronLock(name, leaseMs, fn) {
  const locks = mongoose.connection.collection('cronlocks');
  const now = new Date();
  try {
    await locks.findOneAndUpdate(
      { _id: name, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
      { $set: { lockedUntil: new Date(now.getTime() + leaseMs), lockedAt: now, holder: `${os.hostname()}:${process.pid}` } },
      { upsert: true }
    );
  } catch (err) {
    // The lease exists and is still running: the upsert tried to insert a
    // second document with the same _id.
    if (err?.code === 11000) return { skipped: true };
    throw err;
  }
  return fn();
}
