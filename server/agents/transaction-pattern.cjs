const sigmoid = value => 1 / (1 + Math.exp(-value));

function scoreTransactionPattern(tx, account, outgoing, now) {
  const reasons = [];
  const average = account.avg || 800;
  const amountRatio = Math.max(0.5, tx.amt / average);
  const velocity = 1 + outgoing.filter(edge => edge.a === account.id && !edge.ghost && now - edge.t < 120).length;
  const night = tx.hour < 5 ? 1 : 0;
  const anomaly = 1.4 * Math.max(0, Math.log(amountRatio) - 1) + 0.45 * Math.max(0, velocity - 2) + 1.6 * night;
  if (amountRatio >= 4) reasons.push(`Amount ${amountRatio.toFixed(0)}× this account's average`);
  if (velocity >= 4) reasons.push(`${velocity} outgoing payments in 2 minutes`);
  if (night) reasons.push(`Unusual hour ${formatHour(tx.hour)}`);
  return { score: sigmoid(anomaly - 2.8), reasons, amountRatio, velocity };
}

function formatHour(hour) {
  const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

module.exports = { scoreTransactionPattern };
