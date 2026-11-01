// Claim settlement calculation (IWA-F-023).
//
//   eligible         = min(approvedAmount, sumInsured - alreadySettled)
//   afterDeductible  = max(0, eligible - deductible)
//   copay            = afterDeductible * copayRate
//   payable          = afterDeductible - copay
const { round2 } = require('../core/util');

const POLICY_TERMS = {
  health: { deductible: 5000, copayRate: 0.1 },
  motor: { deductible: 2500, copayRate: 0 },
  home: { deductible: 10000, copayRate: 0 },
  life: { deductible: 0, copayRate: 0 },
};

function computeSettlement({ coverageType, approvedAmount, sumInsured, alreadySettled = 0 }) {
  const terms = POLICY_TERMS[coverageType];
  if (!terms) throw new Error(`No settlement terms for coverage '${coverageType}'`);
  const remainingCover = Math.max(0, sumInsured - alreadySettled);
  const eligible = Math.min(approvedAmount, remainingCover);
  const afterDeductible = Math.max(0, eligible - terms.deductible);
  const copay = afterDeductible * terms.copayRate;
  return {
    approvedAmount: round2(approvedAmount),
    remainingCover: round2(remainingCover),
    eligibleAmount: round2(eligible),
    deductible: terms.deductible,
    copayRate: terms.copayRate,
    copayAmount: round2(copay),
    payableAmount: round2(afterDeductible - copay),
  };
}

module.exports = { computeSettlement, POLICY_TERMS };
