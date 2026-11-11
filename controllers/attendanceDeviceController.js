// HR's Attendance Device page (2026-11-11). Always the user's own company.
import DeviceDay from '../models/DeviceDay.js';
import DevicePunch from '../models/DevicePunch.js';
import DeviceSyncSetting from '../models/DeviceSyncSetting.js';
import User from '../models/User.js';
import { cleanDeviceCode, deviceCodeTaken } from '../services/peopleService.js';
import { applyCode, indiaDate, unknownStatuses, unmatchedCodes } from '../services/deviceSync/deviceProcess.js';
import { redownloadMonth, saveLogin, syncNow, testLogin } from '../services/deviceSync/deviceSyncService.js';

const fail = (res, err) => {
  console.error('[DeviceSync] Request failed:', err.message);
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
};

const needCompany = (req, res, next) => (
  req.user?.companyId ? next() : res.status(400).json({ success: false, message: 'This page works inside one company, and this user has none.' })
);
export { needCompany };

export const getStatus = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const [setting, unknown] = await Promise.all([
      DeviceSyncSetting.findOne({ companyId }).lean(),
      unknownStatuses(companyId),
    ]);
    res.json({
      success: true,
      data: {
        loginSaved: !!setting?.loginSaved,
        loginRefused: !!setting?.loginRefused,
        syncFrom: setting?.syncFrom || null,
        lastSyncAt: setting?.lastSyncAt || null,
        lastError: setting?.lastError || '',
        lastErrorAt: setting?.lastErrorAt || null,
        unknownStatuses: unknown,
      },
    });
  } catch (err) { fail(res, err); }
};

export const getUnmatched = async (req, res) => {
  try {
    res.json({ success: true, data: await unmatchedCodes(req.user.companyId) });
  } catch (err) { fail(res, err); }
};

export const linkCode = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const deviceCode = cleanDeviceCode(req.body?.code);
    const { userId } = req.body || {};
    if (!deviceCode || !userId) return res.status(400).json({ success: false, message: 'Pick a code and a person.' });
    const onDevice = await DeviceDay.exists({ companyId, code: deviceCode }) || await DevicePunch.exists({ companyId, code: deviceCode });
    if (!onDevice) return res.status(400).json({ success: false, message: `Code ${deviceCode} isn't on the device.` });
    const user = await User.findOne({ _id: userId, companyId }).select('deviceCode fullName').lean();
    if (!user) return res.status(404).json({ success: false, message: 'That person is not in this company.' });
    if (user.deviceCode) return res.status(400).json({ success: false, message: `${user.fullName || 'This person'} already has code ${user.deviceCode}. Change it on their profile.` });
    if (await deviceCodeTaken(companyId, deviceCode)) return res.status(400).json({ success: false, message: `Device code ${deviceCode} is already given to someone in this company.` });
    await User.updateOne({ _id: userId, companyId }, { $set: { deviceCode } });
    const result = await applyCode(companyId, deviceCode);
    res.json({ success: true, filled: result.written || 0 });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'That device code is already given to someone in this company.' });
    fail(res, err);
  }
};

const answer = (res, result) => res.status(result.ok ? 200 : 400).json({ success: result.ok, ...result });

export const postSync = async (req, res) => {
  try {
    answer(res, await syncNow(req.user.companyId));
  } catch (err) { fail(res, err); }
};

export const postRedownload = async (req, res) => {
  try {
    const month = String(req.body?.month || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ success: false, message: 'Pick a month.' });
    answer(res, await redownloadMonth(req.user.companyId, month));
  } catch (err) { fail(res, err); }
};

const loginFrom = (body) => ({
  corporateId: String(body?.corporateId || '').trim(),
  username: String(body?.username || '').trim(),
  password: String(body?.password || ''),
});

export const putLogin = async (req, res) => {
  try {
    const login = loginFrom(req.body);
    if (!login.corporateId || !login.username || !login.password) {
      return res.status(400).json({ success: false, message: 'Corporate ID, username and password are all required.' });
    }
    const syncFrom = req.body?.syncFrom ? String(req.body.syncFrom) : null;
    if (syncFrom && (!/^\d{4}-\d{2}-\d{2}$/.test(syncFrom) || syncFrom > indiaDate())) {
      return res.status(400).json({ success: false, message: 'Sync From must be a date, today or earlier.' });
    }
    await saveLogin(req.user.companyId, { ...login, syncFrom });
    res.json({ success: true, message: 'Login saved.' });
  } catch (err) { fail(res, err); }
};

export const postTest = async (req, res) => {
  try {
    answer(res, await testLogin(req.user.companyId, loginFrom(req.body)));
  } catch (err) { fail(res, err); }
};
