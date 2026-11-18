const DAY_MS = 86_400_000;

const round2 = (n) => Math.round(n * 100) / 100;

const toDate = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
const isoDate = (d) => d.toISOString().slice(0, 10);
const addDays = (s, days) => isoDate(new Date(toDate(s).getTime() + days * DAY_MS));
const addYears = (s, years) => {
  const d = toDate(s);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return isoDate(d);
};
const daysBetween = (from, to) => Math.round((toDate(to) - toDate(from)) / DAY_MS);
const today = () => isoDate(new Date());

function ageOn(dob, on = today()) {
  const b = toDate(dob);
  const d = toDate(on);
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const m = d.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && d.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

// A real calendar date in YYYY-MM-DD form. Date silently rolls impossible
// dates over (2026-02-30 -> 2026-03-02), so require the round trip to match.
const isIsoDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = toDate(s);
  return !Number.isNaN(d.getTime()) && isoDate(d) === s;
};

// A number from a JSON body: a finite number, or a plain decimal string such
// as "1500", "-3" or "1500.50" (what HTML number inputs send). Anything else
// returns NaN. Number() alone would turn true into 1, [5] into 5, "" into 0
// and "0x10" into 16 (DEF-03..07), so callers' range checks never saw them.
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
const parseNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && DECIMAL_RE.test(v.trim())) return Number(v.trim());
  return NaN;
};

// Wrap async route handlers so rejected promises reach the error handler.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const parseJson = (s, fallback = null) => {
  try {
    return s == null ? fallback : JSON.parse(s);
  } catch {
    return fallback;
  }
};

// Strips HTML tags and stray angle brackets to prevent stored XSS attacks
const sanitizeText = (s, maxLen = 2000) => {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .slice(0, maxLen)
    .trim();
};

module.exports = { DAY_MS, round2, addDays, addYears, daysBetween, today, ageOn, isIsoDate, parseNumber, ah, parseJson, isoDate, toDate, sanitizeText };
