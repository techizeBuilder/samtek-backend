// Process: turns device rows into attendance. Doesn't care where the rows came
// from, so it's tested with made-up rows. Logic and worked examples:
// docs/client-features-2026-11/02b-device-sync-logic.md
import Attendance from '../../models/Attendance.js';
import DeviceDay from '../../models/DeviceDay.js';
import DevicePunch from '../../models/DevicePunch.js';
import DeviceSyncSetting from '../../models/DeviceSyncSetting.js';
import User from '../../models/User.js';

// Device times carry no timezone and mean India time, whatever the server's clock.
const IST_MS = 5.5 * 3600 * 1000;
const code = (v) => String(v ?? '').trim();

export const indiaDate = (d = new Date()) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);

const instant = (date, h, m, s = 0) => {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m, s) - IST_MS);
};

// dd/MM/yyyy -> YYYY-MM-DD, or null.
export function parseDeviceDate(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(text ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// dd/MM/yyyy HH:mm:ss -> { date, at }, or null.
export function parseDevicePunch(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const date = `${m[3]}-${m[2]}-${m[1]}`;
  return { date, at: instant(date, +m[4], +m[5], +m[6]) };
}

// HH:MM, or null for --:-- and anything else.
const clock = (text) => (/^\d{1,2}:\d{2}$/.test(String(text ?? '').trim()) ? String(text).trim() : null);
const seconds = (text) => {
  const c = clock(text);
  if (!c) return 0;
  const [h, m] = c.split(':').map(Number);
  return h * 3600 + m * 60;
};

const STATUS = { P: 'PRESENT', 'P/2': 'HALF_DAY', A: 'ABSENT', WO: 'WEEKLY_OFF' };
export const isKnownStatus = (status) => Object.hasOwn(STATUS, status);

// The attendance fields for one device day.
export function attendanceFromDay(day) {
  const inMin = day.inTime ? seconds(day.inTime) / 60 : null;
  const outMin = day.outTime ? seconds(day.outTime) / 60 : null;
  const punchIn = inMin === null ? null : instant(day.date, Math.floor(inMin / 60), inMin % 60);
  let punchOut = outMin === null ? null : instant(day.date, Math.floor(outMin / 60), outMin % 60);
  // OUT earlier than IN: the shift crossed midnight.
  if (punchIn && punchOut && punchOut < punchIn) punchOut = new Date(punchOut.getTime() + 864e5);
  const status = STATUS[day.status] || (punchIn || punchOut ? 'PRESENT' : 'ABSENT');
  return {
    punchIn,
    punchOut,
    status,
    totalWorkSeconds: day.workSeconds || 0,
    totalBreakSeconds: day.breakSeconds || 0,
    overtimeSeconds: day.overtimeSeconds || 0,
    lateSeconds: day.lateSeconds || 0,
    earlyOutSeconds: day.earlyOutSeconds || 0,
    deviceStatus: day.status || '',
    deviceRemark: day.remark || '',
    deviceCode: day.code,
    source: 'Device',
  };
}

async function usersByCode(companyId, codes) {
  const users = await User.find({ companyId, deviceCode: { $in: codes } }).select('deviceCode joiningDate').lean();
  return new Map(users.map((u) => [u.deviceCode, u]));
}

const onOrAfterJoining = (user, date) => !user.joiningDate || date >= indiaDate(user.joiningDate);

// API 2 or 4 rows. A punch already saved is skipped.
export async function savePunches(companyId, rows) {
  const parsed = [];
  let skipped = 0;
  for (const row of rows || []) {
    const when = parseDevicePunch(row.PunchDate);
    if (!when || !code(row.Empcode)) { skipped++; continue; }
    parsed.push({ row, ...when, code: code(row.Empcode) });
  }
  if (!parsed.length) return { saved: 0, skipped };
  const people = await usersByCode(companyId, [...new Set(parsed.map((p) => p.code))]);
  const result = await DevicePunch.bulkWrite(parsed.map((p) => {
    const user = people.get(p.code);
    return {
      updateOne: {
        filter: { companyId, code: p.code, punchAt: p.at },
        update: {
          $set: { name: p.row.Name || '', byHand: p.row.M_Flag === 'M', ...(p.row.mcid ? { deviceId: String(p.row.mcid) } : {}) },
          $setOnInsert: { date: p.date, user: user && onOrAfterJoining(user, p.date) ? user._id : null },
        },
        upsert: true,
      },
    };
  }), { ordered: false });
  return { saved: result.upsertedCount, skipped };
}

// After a full download of a range, each day it returned punches for becomes exactly
// what came back. A day with nothing back is left alone: that's as likely a hiccup
// as a day with no punches.
export async function reconcilePunches(companyId, rows) {
  const { saved, skipped } = await savePunches(companyId, rows);
  const byDate = new Map();
  for (const row of rows || []) {
    const when = parseDevicePunch(row.PunchDate);
    if (!when || !code(row.Empcode)) continue;
    if (!byDate.has(when.date)) byDate.set(when.date, new Set());
    byDate.get(when.date).add(`${code(row.Empcode)}|${when.at.getTime()}`);
  }
  let removed = 0;
  for (const [date, keep] of byDate) {
    const existing = await DevicePunch.find({ companyId, date }).select('code punchAt').lean();
    const gone = existing.filter((p) => !keep.has(`${p.code}|${new Date(p.punchAt).getTime()}`)).map((p) => p._id);
    if (gone.length) removed += (await DevicePunch.deleteMany({ _id: { $in: gone } })).deletedCount;
  }
  return { saved, skipped, removed };
}

// API 3 rows.
export async function saveDays(companyId, rows) {
  const ops = [];
  let skipped = 0;
  for (const row of rows || []) {
    const date = parseDeviceDate(row.DateString);
    if (!date || !code(row.Empcode)) { skipped++; continue; }
    ops.push({
      updateOne: {
        filter: { companyId, code: code(row.Empcode), date },
        update: {
          $set: {
            name: row.Name || '',
            inTime: clock(row.INTime),
            outTime: clock(row.OUTTime),
            workSeconds: seconds(row.WorkTime),
            overtimeSeconds: seconds(row.OverTime),
            breakSeconds: seconds(row.BreakTime),
            lateSeconds: seconds(row.Late_In),
            earlyOutSeconds: seconds(row.Erl_Out),
            status: String(row.Status ?? '').trim().toUpperCase(),
            remark: String(row.Remark ?? '').trim(),
          },
        },
        upsert: true,
      },
    });
  }
  if (ops.length) await DeviceDay.bulkWrite(ops, { ordered: false });
  return { saved: ops.length, skipped };
}

// Device days -> attendance. Only for matched people, on or after their joining
// date and Sync From. Leaves HR's corrections and self-marked days alone, and a
// day this code already built for someone else stays with them.
export async function buildAttendance(companyId, { codes = null, from = null, to = null } = {}) {
  const dateRange = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const days = await DeviceDay.find({
    companyId,
    ...(codes ? { code: { $in: codes } } : {}),
    ...(from || to ? { date: dateRange } : {}),
  }).lean();
  const stats = { written: 0, protected: 0, unmatched: 0 };
  if (!days.length) return stats;

  const setting = await DeviceSyncSetting.findOne({ companyId }).select('syncFrom').lean();
  const people = await usersByCode(companyId, [...new Set(days.map((d) => d.code))]);
  const userIds = [...people.values()].map((u) => u._id);
  const dates = [...new Set(days.map((d) => d.date))];
  // Attendance has no company of its own, and two companies can share a code, so
  // "someone else" must mean someone else in this company.
  const matched = new Set(userIds.map(String));
  const othersHere = (await User.find({ companyId }).distinct('_id')).filter((id) => !matched.has(String(id)));
  const [existing, builtForOthers] = await Promise.all([
    Attendance.find({ user: { $in: userIds }, date: { $in: dates } }).select('user date source').lean(),
    Attendance.find({ deviceCode: { $in: [...people.keys()] }, date: { $in: dates }, user: { $in: othersHere } }).select('deviceCode date').lean(),
  ]);
  const existingOf = new Map(existing.map((a) => [`${a.user}|${a.date}`, a]));
  const taken = new Set(builtForOthers.map((a) => `${a.deviceCode}|${a.date}`));

  for (const day of days) {
    const user = people.get(day.code);
    if (!user) { stats.unmatched++; continue; }
    if (!onOrAfterJoining(user, day.date) || (setting?.syncFrom && day.date < setting.syncFrom)) continue;
    if (taken.has(`${day.code}|${day.date}`)) continue;
    const current = existingOf.get(`${user._id}|${day.date}`);
    if (current && current.source !== 'Device') { stats.protected++; continue; }
    const fields = attendanceFromDay(day);
    if (current) {
      // Matched on source too, in case a correction landed a moment ago.
      await Attendance.updateOne({ _id: current._id, source: 'Device' }, { $set: fields });
    } else {
      try {
        await Attendance.create({ user: user._id, date: day.date, ...fields });
      } catch (err) {
        if (err.code !== 11000) throw err;
        continue;
      }
    }
    stats.written++;
  }
  return stats;
}

// A code has just been given to someone: their earlier days fill in.
export async function applyCode(companyId, deviceCode) {
  const user = await User.findOne({ companyId, deviceCode }).select('joiningDate').lean();
  if (!user) return { written: 0 };
  await DevicePunch.updateMany(
    { companyId, code: deviceCode, user: null, ...(user.joiningDate ? { date: { $gte: indiaDate(user.joiningDate) } } : {}) },
    { $set: { user: user._id } },
  );
  return buildAttendance(companyId, { codes: [deviceCode] });
}

// For saves that must not fail because of this.
export async function applyCodeQuietly(companyId, deviceCode) {
  try {
    if (companyId && deviceCode) await applyCode(companyId, deviceCode);
  } catch (err) {
    console.error('[DeviceSync] Filling in earlier days failed:', err.message);
  }
}

// Codes on the device that nobody has. Bounded by headcount, so not paged.
export async function unmatchedCodes(companyId) {
  const [days, punches, held] = await Promise.all([
    DeviceDay.aggregate([
      { $match: { companyId } },
      { $sort: { date: 1 } },
      { $group: {
        _id: '$code',
        name: { $last: '$name' },
        days: { $sum: { $cond: [{ $ne: ['$inTime', null] }, 1, 0] } },
        lastSeen: { $max: { $cond: [{ $ne: ['$inTime', null] }, '$date', null] } },
      } },
    ]),
    DevicePunch.aggregate([
      { $match: { companyId } },
      { $sort: { date: 1 } },
      { $group: { _id: '$code', name: { $last: '$name' }, lastSeen: { $max: '$date' } } },
    ]),
    User.distinct('deviceCode', { companyId, deviceCode: { $type: 'string' } }),
  ]);
  const heldSet = new Set(held);
  const list = new Map();
  for (const d of days) list.set(d._id, { code: d._id, name: d.name, days: d.days, lastSeen: d.lastSeen });
  for (const p of punches) {
    const row = list.get(p._id);
    if (!row) list.set(p._id, { code: p._id, name: p.name, days: 0, lastSeen: p.lastSeen });
    else if (!row.lastSeen || p.lastSeen > row.lastSeen) row.lastSeen = p.lastSeen;
  }
  return [...list.values()]
    .filter((r) => !heldSet.has(r.code))
    .sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')) || a.code.localeCompare(b.code));
}

export async function unknownStatuses(companyId) {
  const statuses = await DeviceDay.distinct('status', { companyId });
  return statuses.filter((s) => s && !isKnownStatus(s)).sort();
}
