// Rule-based fraud detection (IWA-F-022). Pure function: given the claim and
// its context, returns a score and the rules that fired.
const { daysBetween } = require('../core/util');

const FLAG_THRESHOLD = 50;

function detectFraud({ claim, policy, priorClaims = [], documentsCount = 0, reportedOn, remainingCover }) {
  const flags = [];
  const add = (code, points, message) => flags.push({ code, points, message });
  const active = priorClaims.filter((c) => c.status !== 'REJECTED');

  const duplicate = active.find(
    (c) => c.claim_type === claim.claimType && Math.abs(daysBetween(c.incident_date, claim.incidentDate)) <= 7,
  );
  if (duplicate) add('DUPLICATE_CLAIM', 60, `Same claim type within 7 days of claim ${duplicate.id}`);

  if (claim.amount > remainingCover) add('EXCEEDS_REMAINING_COVER', 30, 'Claimed amount exceeds the remaining sum insured');
  else if (claim.amount > policy.sum_insured * 0.8) add('HIGH_VALUE_RATIO', 20, 'Claimed amount is over 80% of the sum insured');

  if (daysBetween(policy.start_date, claim.incidentDate) <= 30) add('EARLY_CLAIM', 25, 'Incident within 30 days of policy start');

  const recent = active.filter((c) => daysBetween(c.created_at.slice(0, 10), reportedOn) <= 90);
  if (recent.length >= 2) add('FREQUENT_CLAIMS', 25, `${recent.length} other claims on this policy in the last 90 days`);

  if (documentsCount === 0) add('NO_SUPPORTING_DOCUMENTS', 15, 'No supporting documents uploaded');

  if (daysBetween(claim.incidentDate, reportedOn) > 30) add('LATE_REPORTING', 10, 'Reported more than 30 days after the incident');

  const score = Math.min(100, flags.reduce((s, f) => s + f.points, 0));
  return { score, flags, flagged: score >= FLAG_THRESHOLD || !!duplicate };
}

module.exports = { detectFraud, FLAG_THRESHOLD };
