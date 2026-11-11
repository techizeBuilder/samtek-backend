// Ties Fetch to Process, per company. baseUrl is for tests only: no route passes it.
import DeviceSyncSetting from '../../models/DeviceSyncSetting.js';
import { decryptCashPassword, encryptCashPassword } from '../../utils/cashCrypto.js';
import { createClient, LoginRefusedError } from './etimeClient.js';
import { buildAttendance, indiaDate, reconcilePunches, saveDays, savePunches } from './deviceProcess.js';

const LOGIN_FIELDS = '+corporateIdEnc +usernameEnc +passwordEnc';
const BOOKMARK = /^\d{6}\$\d+$/;

const yesterdayOf = (date) => indiaDate(new Date(`${date}T12:00:00+05:30`).getTime() - 864e5);

const clientFor = (setting, baseUrl) => createClient({
  corporateId: decryptCashPassword(setting.corporateIdEnc),
  username: decryptCashPassword(setting.usernameEnc),
  password: decryptCashPassword(setting.passwordEnc),
}, baseUrl ? { baseUrl } : {});

// The first bookmark: the start of this month.
const startBookmark = (today) => `${today.slice(5, 7)}${today.slice(0, 4)}$0`;

// Runs one company's job, recording how it went. A refused login stops the sync
// for this company until the login is saved again.
async function run(setting, job) {
  try {
    const result = await job();
    setting.lastSyncAt = new Date();
    setting.lastError = '';
    setting.lastErrorAt = null;
    await setting.save();
    return { ok: true, ...result };
  } catch (err) {
    const refused = err instanceof LoginRefusedError;
    setting.loginRefused = refused || setting.loginRefused;
    setting.lastError = refused ? 'The device refused this login. Save the login again to restart the sync.' : err.message;
    setting.lastErrorAt = new Date();
    await setting.save();
    console.error(`[DeviceSync] Company ${setting.companyId} failed: ${setting.lastError}`);
    return { ok: false, refused, message: setting.lastError };
  }
}

async function syncCompany(setting, baseUrl) {
  return run(setting, async () => {
    const client = clientFor(setting, baseUrl);
    const today = indiaDate();
    const latest = await client.lastPunches(setting.bookmark || startBookmark(today));
    const rows = latest?.PunchData || [];
    let punches = { saved: 0 };
    if (rows.length) {
      punches = await savePunches(setting.companyId, rows);
      // Only when punches came back: with nothing new the API returns "0".
      if (BOOKMARK.test(String(latest.MaxRecord || ''))) setting.bookmark = latest.MaxRecord;
    }
    const yesterday = yesterdayOf(today);
    const results = await client.dayResults(yesterday, today);
    await saveDays(setting.companyId, results?.InOutPunchData || []);
    const attendance = await buildAttendance(setting.companyId, { from: yesterday, to: today });
    return { punches: punches.saved, attendance: attendance.written };
  });
}

// A full download of a range: punches become exactly what came back.
async function downloadRange(setting, from, to, baseUrl) {
  return run(setting, async () => {
    const client = clientFor(setting, baseUrl);
    const all = await client.punches(from, to);
    const days = await client.dayResults(from, to);
    const punches = await reconcilePunches(setting.companyId, all?.PunchData || []);
    await saveDays(setting.companyId, days?.InOutPunchData || []);
    const attendance = await buildAttendance(setting.companyId, { from, to });
    return { punches: punches.saved, removed: punches.removed, attendance: attendance.written };
  });
}

const activeSettings = (companyId) => DeviceSyncSetting.find({
  ...(companyId ? { companyId } : {}),
  loginSaved: true,
  loginRefused: { $ne: true },
}).select(LOGIN_FIELDS);

async function forEachCompany(companyId, job) {
  const settings = await activeSettings(companyId);
  const results = [];
  for (const setting of settings) {
    try {
      results.push(await job(setting));
    } catch (err) {
      console.error(`[DeviceSync] Company ${setting.companyId} failed: ${err.message}`);
    }
  }
  return results;
}

// Every 15 minutes.
export const runDeviceSync = ({ companyId = null, baseUrl } = {}) => forEachCompany(companyId, (s) => syncCompany(s, baseUrl));

// Every night: yesterday in full, to catch hand-typed punches and edits.
export const runDeviceNightly = ({ companyId = null, baseUrl } = {}) => forEachCompany(companyId, (s) => {
  const yesterday = yesterdayOf(indiaDate());
  return downloadRange(s, yesterday, yesterday, baseUrl);
});

const settingToRun = async (companyId) => {
  const setting = await DeviceSyncSetting.findOne({ companyId }).select(LOGIN_FIELDS);
  if (!setting?.loginSaved) return { problem: 'No device login is saved yet.' };
  if (setting.loginRefused) return { problem: 'The device refused this login. Save the login again first.' };
  return { setting };
};

export async function syncNow(companyId, { baseUrl } = {}) {
  const { setting, problem } = await settingToRun(companyId);
  return problem ? { ok: false, message: problem } : syncCompany(setting, baseUrl);
}

// month: YYYY-MM. Up to today.
export async function redownloadMonth(companyId, month, { baseUrl } = {}) {
  const { setting, problem } = await settingToRun(companyId);
  if (problem) return { ok: false, message: problem };
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const today = indiaDate();
  if (from > today) return { ok: false, message: 'That month has not started yet.' };
  return downloadRange(setting, from, last < today ? last : today, baseUrl);
}

export async function saveLogin(companyId, { corporateId, username, password, syncFrom }) {
  const setting = await DeviceSyncSetting.findOne({ companyId }) || new DeviceSyncSetting({ companyId });
  setting.corporateIdEnc = encryptCashPassword(corporateId);
  setting.usernameEnc = encryptCashPassword(username);
  setting.passwordEnc = encryptCashPassword(password);
  setting.loginSaved = true;
  setting.loginRefused = false;
  setting.lastError = '';
  setting.lastErrorAt = null;
  setting.syncFrom = syncFrom || setting.syncFrom || indiaDate();
  await setting.save();
}

// Tries a login without saving anything. Only says whether it worked and how many
// rows came back: the rows hold real names.
export async function testLogin(companyId, login, { baseUrl } = {}) {
  let client;
  if (login?.corporateId && login?.username && login?.password) {
    client = createClient(login, baseUrl ? { baseUrl } : {});
  } else {
    const setting = await DeviceSyncSetting.findOne({ companyId }).select(LOGIN_FIELDS);
    if (!setting?.loginSaved) return { ok: false, message: 'No device login is saved yet.' };
    client = clientFor(setting, baseUrl);
  }
  try {
    const today = indiaDate();
    const result = await client.dayResults(today, today);
    return { ok: true, rows: (result?.InOutPunchData || []).length };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
