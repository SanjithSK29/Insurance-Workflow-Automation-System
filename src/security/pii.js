// PII masking for API responses and logs (IWA-SR-003).

// Roles allowed to see unmasked identity data.
const PII_AUTHORIZED_ROLES = new Set(['UNDERWRITER', 'ADMIN']);

const tail = (s, n) => String(s).slice(-n);

const maskAadhaar = (v) => (v ? `XXXX-XXXX-${tail(v, 4)}` : v);
const maskPan = (v) => (v ? `XXXXXX${tail(v, 4)}` : v);
const maskPhone = (v) => (v ? `******${tail(v, 4)}` : v);
const maskEmail = (v) => {
  if (!v || !v.includes('@')) return v;
  const [user, domain] = v.split('@');
  return `${user[0]}***@${domain}`;
};

const canSeePii = (user) => !!user && PII_AUTHORIZED_ROLES.has(user.role);

// Redact anything that looks like PII from free text (used on every log line).
function redactPii(text) {
  return String(text)
    .replace(/\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g, '[AADHAAR]')
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[PAN]')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[EMAIL]')
    .replace(/(?<!\d)(?:\+91[ -]?)?[6-9]\d{9}(?!\d)/g, '[PHONE]');
}

module.exports = { maskAadhaar, maskPan, maskPhone, maskEmail, canSeePii, redactPii, PII_AUTHORIZED_ROLES };
