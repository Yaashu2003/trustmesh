function orchestrate(scores) {
  const values = [scores.tvp, scores.behavior, scores.graph];
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const blended = 0.6 * max + 0.4 * mean;
  if (max > 0.85) return { verdict: 'BLOCK', score: max, blended, reason: `Veto: strongest agent ${max.toFixed(2)} is above 0.85` };
  if (blended > 0.6) return { verdict: 'HOLD', score: blended, blended, reason: `Blend 0.6·max + 0.4·mean = ${blended.toFixed(2)} is above 0.60` };
  return { verdict: 'APPROVE', score: blended, blended, reason: `Blend 0.6·max + 0.4·mean = ${blended.toFixed(2)} is at or below 0.60` };
}

module.exports = { orchestrate };
