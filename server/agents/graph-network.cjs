function scoreGraph(tx, S, cfg, { WIN, sigmoid, logit, devCount, graphStore }) {
  const reasons = [], from = tx.from, to = tx.to;
  const und = new Map(), out = new Map(), amountByEdge = new Map();
  const add = (map, a, b) => { if (!map.has(a)) map.set(a, new Set()); map.get(a).add(b); };
  const eligible = edge => cfg.share || S.nodes.get(edge.a).bank === S.nodes.get(edge.b).bank;
  const existing = graphStore
    ? graphStore.recentEdges(S.now, WIN, eligible)
    : S.edges.filter(edge => !edge.ghost && S.now - edge.t < WIN).filter(eligible);
  const edges = existing.concat([{ a: from, b: to, amt: tx.amt, t: S.now, id: -1, hyp: true }]);
  edges.forEach(edge => { add(und, edge.a, edge.b); add(und, edge.b, edge.a); add(out, edge.a, edge.b); amountByEdge.set(`${edge.a}>${edge.b}`, edge.amt); });
  S.links.forEach(link => {
    const a = S.nodes.get(link.a), b = S.nodes.get(link.b);
    if (link.kind !== 'dev' || (!cfg.share && a.bank !== b.bank)) return;
    add(und, link.a, link.b); add(und, link.b, link.a);
  });

  let cycle = null;
  (function walk(current, path) {
    if (cycle || path.length > 4) return;
    (out.get(current) || []).forEach(next => {
      if (cycle) return;
      if (next === from) {
        const loop = [from].concat(path, [from]);
        const amounts = [];
        for (let i = 0; i < loop.length - 1; i++) amounts.push(amountByEdge.get(`${loop[i]}>${loop[i + 1]}`));
        if (path.length + 1 >= 3 && Math.min(...amounts) / Math.max(...amounts) >= 0.7) cycle = path.concat([next]);
        return;
      }
      if (!path.includes(next)) walk(next, path.concat([next]));
    });
  })(to, [to]);
  const cycleNodes = new Set(cycle ? cycle.concat([from]) : []);
  S.m.yb += cycle ? 3 : 2;

  const stats = id => {
    let inSum = 0, outSum = 0, inCount = 0, outCount = 0;
    const senders = new Set();
    edges.forEach(edge => {
      if (edge.b === id) { inSum += edge.amt; inCount++; senders.add(edge.a); }
      if (edge.a === id) { outSum += edge.amt; outCount++; }
    });
    return { inSum, outSum, inCount, outCount, fanIn: senders.size };
  };
  const ownMemo = new Map();
  const ownRisk = id => {
    if (ownMemo.has(id)) return ownMemo.get(id);
    const node = S.nodes.get(id); let value;
    if (!node) return 0.03;
    if (node.type === 'dev') value = 4 * Math.min((devCount(id, node.bank) - 1) / 4, 1) - 3;
    else if (node.type === 'merch') value = -3.3;
    else {
      const s = stats(id);
      const passThrough = s.inCount && s.outCount ? Math.min(s.inSum, s.outSum) / Math.max(s.inSum, s.outSum) : 0;
      const newAccount = node.age < 30 ? 1 : 0;
      const velocity = Math.min(s.outCount / 6, 1);
      const deviceRisk = Math.min(Math.max(devCount(node.homeDev, node.bank) - 1, 0) / 6, 1);
      const fanIn = Math.min(s.fanIn / 10, 1.4);
      value = 2.4 * passThrough + 1.5 * newAccount + 1.2 * velocity + 1.8 * deviceRisk + 3 * fanIn - 3.1;
      if (node.bl) value += 3;
    }
    if (cycleNodes.has(id)) value += 2;
    const score = sigmoid(value); ownMemo.set(id, score); return score;
  };
  const neighbors = id => {
    const node = S.nodes.get(id), linked = und.get(id);
    if (!linked || !node) return [];
    return [...linked].filter(other => cfg.share || S.nodes.get(other).bank === node.bank);
  };
  const propagate = previous => {
    const memo = new Map();
    return id => {
      if (memo.has(id)) return memo.get(id);
      const adjacent = neighbors(id);
      const evidence = adjacent.length
        ? adjacent.reduce((sum, neighbor) => sum + Math.max(0, logit(previous(neighbor)) + 1), 0) / adjacent.length
        : 0;
      const result = sigmoid(logit(previous(id)) + 0.9 * evidence);
      memo.set(id, result); return result;
    };
  };
  const layer1 = propagate(ownRisk), layer2 = propagate(layer1);
  const fromRisk = layer2(from), toRisk = layer2(to);
  const score = cfg.graph ? Math.max(fromRisk, toRisk) : 0;
  if (cycle) {
    const names = [from].concat(cycle).slice(0, 5).map(id => S.nodes.get(id).label);
    const banks = new Set([from].concat(cycle).map(id => S.nodes.get(id).bank));
    reasons.push(`Closed ${cycle.length}-hop loop ${names.join('→')} across ${banks.size} banks`);
  }
  const receiverStats = stats(to), receiver = S.nodes.get(to);
  if (receiverStats.fanIn >= 6 && receiver.type === 'acct') reasons.push(`Receiver fan-in: ${receiverStats.fanIn} distinct senders in ${WIN}s`);
  const receiverDevices = devCount(receiver.homeDev, receiver.bank);
  if (receiverDevices >= 3) reasons.push(`Receiver device shared by ${receiverDevices} accounts`);
  const senderStats = stats(from);
  if (senderStats.inCount && senderStats.outCount && Math.min(senderStats.inSum, senderStats.outSum) / Math.max(senderStats.inSum, senderStats.outSum) > 0.85) reasons.push('Pass-through: funds relayed within seconds');
  if (receiver.age < 30 && tx.amt >= 1500 && receiver.type === 'acct') reasons.push('Payee is a days-old account');

  const subgraph = new Set([from, to]);
  (cycle || []).forEach(id => subgraph.add(id));
  [from, to].forEach(id => neighbors(id).slice(0, 8).forEach(id => subgraph.add(id)));
  [...subgraph].slice(0, 40).forEach(id => {
    if (S.nodes.get(id)?.type !== 'dev') neighbors(id).slice(0, 3).forEach(other => { if (subgraph.size < 26) subgraph.add(other); });
  });
  const evidenceNodes = [...subgraph].slice(0, 26), messagePassing = {};
  evidenceNodes.forEach(id => { messagePassing[id] = [ownRisk(id), layer1(id), layer2(id)]; });
  return {
    score, fromRisk, toRisk, reasons, messagePassing, cycle: cycle ? [from].concat(cycle) : null, subgraph: evidenceNodes,
    layer0: [ownRisk(from), ownRisk(to)], layer1: [layer1(from), layer1(to)], layer2: [fromRisk, toRisk], queryCount: cycle ? 3 : 2,
  };
}

module.exports = { scoreGraph };
