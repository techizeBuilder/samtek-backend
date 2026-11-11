// Fetch: only downloads from e-timeoffice. Everything else is deviceProcess.js.
// Tested behaviour is in docs/client-features-2026-11/02-manpower-attendance-discussion.md
// section 4. Responses hold real names and punch times, so they're never logged.
const BASE_URL = 'https://api.etimeoffice.com/api/';

export class LoginRefusedError extends Error {}

const LOGIN_WORDS = /invalid|unauthori[sz]ed|login|password|credential/i;

// date: YYYY-MM-DD -> the API's dd/MM/yyyy.
export const toDeviceDate = (date) => {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
};

// baseUrl is for tests, which answer from a pretend server.
export function createClient({ corporateId, username, password }, { baseUrl = BASE_URL } = {}) {
  const auth = Buffer.from(`${corporateId}:${username}:${password}:True`, 'utf8').toString('base64');

  async function get(path) {
    let res;
    try {
      res = await fetch(baseUrl + path, {
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(90000),
      });
    } catch (err) {
      throw new Error('Could not reach the device server.');
    }
    if (res.status === 401 || res.status === 403) throw new LoginRefusedError('The device server refused this login.');
    if (!res.ok) throw new Error(`The device server answered ${res.status}.`);
    let json;
    try {
      json = await res.json();
    } catch {
      throw new Error('The device server sent something unreadable.');
    }
    if (json && !Array.isArray(json) && json.Error === true) {
      const msg = String(json.Msg || '').slice(0, 200);
      if (LOGIN_WORDS.test(msg)) throw new LoginRefusedError('The device server refused this login.');
      throw new Error(msg || 'The device server reported an error.');
    }
    return json;
  }

  return {
    // New punches after a bookmark: { PunchData, MaxRecord }.
    lastPunches: (bookmark) => get(`DownloadLastPunchData?Empcode=ALL&LastRecord=${bookmark}`),
    // One row per code per day: { InOutPunchData }.
    dayResults: (from, to) => get(`DownloadInOutPunchData?Empcode=ALL&FromDate=${toDeviceDate(from)}&ToDate=${toDeviceDate(to)}`),
    // Every punch in a range: { PunchData }.
    punches: (from, to) => get(`DownloadPunchDataMCID?Empcode=ALL&FromDate=${toDeviceDate(from)}_00:00&ToDate=${toDeviceDate(to)}_23:59`),
  };
}
