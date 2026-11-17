const sigmoid = value => 1 / (1 + Math.exp(-value));

function scoreBehavior(tx, account, deviceAccountCount = 1) {
  const reasons = [];
  const newDevice = tx.dev !== account.homeDev ? 1 : 0;
  const newSim = tx.sim !== account.homeSim ? 1 : 0;
  const speed = tx.jumpKm / Math.max(tx.jumpMin / 60, 1 / 60);
  const z = 2.0 * newDevice + 2.4 * newSim + 1.6 * Math.min(speed / 800, 1.5)
    + 2.2 * (tx.bot || 0) + 2.0 * Math.min(Math.max(deviceAccountCount - 1, 0) / 5, 1) - 3.0;
  if (newSim) reasons.push('SIM changed minutes before payment');
  if (newDevice) reasons.push('Unrecognised device for this account');
  if (speed > 500) reasons.push(`Impossible travel: ${Math.round(tx.jumpKm)} km in ${tx.jumpMin} min`);
  if (tx.bot) reasons.push('Scripted taps (robotic input timing)');
  if (deviceAccountCount >= 3) reasons.push(`Device shared by ${deviceAccountCount} accounts`);
  return { score: sigmoid(z), reasons, newDevice: !!newDevice, newSim: !!newSim, speedKmh: speed };
}

module.exports = { scoreBehavior };
