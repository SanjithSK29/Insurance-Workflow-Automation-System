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

const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toDate(s).getTime());

// Wrap async route handlers so rejected promises reach the error handler.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const parseJson = (s, fallback = null) => {
  try {
    return s == null ? fallback : JSON.parse(s);
  } catch {
    return fallback;
  }
};

module.exports = { DAY_MS, round2, addDays, addYears, daysBetween, today, ageOn, isIsoDate, ah, parseJson, isoDate, toDate };
