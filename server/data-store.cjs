const { randomUUID } = require('node:crypto');

const BANKS = ['SBI', 'HDFC', 'ICICI', 'Axis'];
const FIRST = ['Aarav','Aditi','Aman','Ananya','Arjun','Diya','Isha','Kabir','Kavya','Meera','Neha','Nikhil','Priya','Rahul','Riya','Rohan','Saanvi','Sana','Sneha','Vihaan','Yash','Zoya'];
const LAST = ['Kapoor','Mehta','Nair','Rao','Sharma','Singh','Patel','Gupta','Iyer','Reddy','Das','Khan','Bose','Menon'];
const MERCHANTS = ['FreshMart','Apollo ER','Chai Point','Metro Cab','PetroPump','BookHub','City Pharmacy','Green Basket','NorthStar Cafe','Urban Transit','QuickFuel','CarePlus'];

function random(seed) {
  let value = seed >>> 0;
  return () => { value = (value + 0x6D2B79F5) | 0; let t = value; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

class TrustMeshStore {
  constructor(targetTransactions = 300000) {
    this.rand = random(0x71a57);
    this.now = Date.now() / 1000;
    this.nodes = new Map();
    this.transactions = [];
    this.links = [];
    this.linkById = new Map();
    this.transactionById = new Map();
    this.linksByNode = new Map();
    this.incident = new Map();
    this.outgoing = new Map();
    this.incoming = new Map();
    this.deviceAccounts = new Map();
    this.accounts = [];
    this.merchants = [];
    this.registry = new Map();
    this.clusterAccounts = new Map();
    this.devices = [];
    this.syntheticFraudTransactions = 0;
    this.targetTransactions = Math.max(1000, Math.min(500000, targetTransactions));
    this.nextTransaction = 1;
    this.seedEntities();
    this.seedTransactionHistory();
    this.seedFraudPatterns();
  }

  pick(items) { return items[Math.floor(this.rand() * items.length)]; }
  number(min, max) { return min + this.rand() * (max - min); }
  addNode(node) { this.nodes.set(node.id, node); return node; }
  relation(a, b, kind, t = this.now) {
    const edge = { id: `rel_${this.links.length + 1}`, a, b, kind, t };
    this.links.push(edge);
    this.linkById.set(edge.id, edge);
    for (const id of [a, b]) { if (!this.linksByNode.has(id)) this.linksByNode.set(id, []); this.linksByNode.get(id).push(edge); }
    return edge;
  }
  addPayment({ id, from, to, amount, t = this.now, truth = 'legit', pattern = null, hour = 12, deviceId, simId, jumpKm = 0, jumpMin = 60, bot = 0, verdict = null }) {
    const edge = { id: id || `tx_${String(this.nextTransaction++).padStart(8, '0')}`, a: from, b: to, amt: Math.round(amount), t, truth, pattern, hour, dev: deviceId, sim: simId, jumpKm, jumpMin, bot, v: verdict || 'APPROVE', ghost: false };
    this.transactions.push(edge);
    this.transactionById.set(edge.id, edge);
    for (const nodeId of [from, to]) { if (!this.incident.has(nodeId)) this.incident.set(nodeId, []); this.incident.get(nodeId).push(edge); }
    if (!this.outgoing.has(from)) this.outgoing.set(from, []); this.outgoing.get(from).push(edge);
    if (!this.incoming.has(to)) this.incoming.set(to, []); this.incoming.get(to).push(edge);
    return edge;
  }
  addAccount({ id, bank, label, age, avg, risk = 0.04, archetype = null }) {
    const serial = this.accounts.length + 1;
    const account = this.addNode({
      id: id || `acc_${String(serial).padStart(6, '0')}`, type: 'acct', bank,
      label: label || `${this.pick(FIRST)} ${this.pick(LAST)}`,
      vpa: '', age: age ?? Math.round(this.number(60, 2200)), avg: avg ?? Math.round(this.number(350, 3200)),
      risk, archetype, bl: false,
    });
    account.vpa = `${account.label.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.${account.id.slice(-3)}@${bank.toLowerCase()}`;
    account.homeDev = `dev_${account.id}`;
    account.homeSim = `sim_${account.id}`;
    this.accounts.push(account);
    const device = this.addNode({ id: account.homeDev, type: 'dev', bank, label: 'Known device', risk: 0.03, shared: false });
    const sim = this.addNode({ id: account.homeSim, type: 'sim', bank, label: 'Known SIM', risk: 0.03 });
    this.devices.push(device);
    this.deviceAccounts.set(device.id, new Set([account.id]));
    this.relation(account.id, device.id, 'dev');
    this.relation(account.id, sim.id, 'sim');
    return account;
  }

  seedEntities() {
    for (let i = 0; i < 10000; i++) this.addAccount({ bank: BANKS[i % BANKS.length] });
    for (let i = 0; i < 48; i++) {
      const bank = BANKS[i % BANKS.length], label = `${MERCHANTS[i % MERCHANTS.length]} ${String(i + 1).padStart(2, '0')}`;
      this.merchants.push(this.addNode({ id: `mer_${String(i + 1).padStart(3, '0')}`, type: 'merch', bank, label, vpa: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@${bank.toLowerCase()}`, risk: 0.02, age: 2000 }));
    }
  }

  seedTransactionHistory() {
    const baseCount = Math.max(0, this.targetTransactions - 1640);
    for (let i = 0; i < baseCount; i++) {
      const from = this.pick(this.accounts);
      let to;
      if (this.rand() < 0.66) to = this.pick(this.merchants);
      else { do { to = this.pick(this.accounts); } while (to.id === from.id); }
      const multiplier = Math.exp((this.rand() - 0.5) * 1.1);
      const amount = Math.max(25, Math.round(from.avg * multiplier / 10) * 10);
      this.addPayment({ from: from.id, to: to.id, amount, t: this.now - this.rand() * 86400, hour: this.number(6, 23) });
    }
  }

  seedFraudPatterns() {
    // Twenty cross-bank mule rings with near-equal pass-through transfers.
    for (let ringNo = 1; ringNo <= 20; ringNo++) {
      const ringId = `cluster_ring_${String(ringNo).padStart(2, '0')}`;
      const members = BANKS.map((bank, index) => this.addAccount({
        id: `mule_${String(ringNo).padStart(2, '0')}_${String.fromCharCode(97 + index)}`,
        bank, label: `Mule ${String(ringNo).padStart(2, '0')}-${String.fromCharCode(65 + index)}`,
        age: 2 + this.rand() * 9, avg: 900, risk: 0.88, archetype: 'mule-ring',
      }));
      this.clusterAccounts.set(ringId, members.map(node => node.id));
      for (let lap = 0; lap < 3; lap++) for (let i = 0; i < 4; i++) {
        const amount = 9850 - i * 50 - lap * 40;
        this.addPayment({ from: members[i].id, to: members[(i + 1) % 4].id, amount, t: this.now - 35 + lap * 4 + i * 0.5, truth: 'fraud', pattern: ringId, hour: 14.2, bot: 1 });
        this.syntheticFraudTransactions++;
      }
      if (ringNo <= 4) members.forEach((node, i) => {
        if (ringNo === 1 || i === 0) { node.bl = true; this.registry.set(node.id, { t: this.now - 120, why: 'Confirmed synthetic mule-ring account', source: 'seeded-risk-network' }); }
      });
    }

    // Twenty smurfing hubs with a broad, cross-bank fan-in.
    for (let hubNo = 1; hubNo <= 20; hubNo++) {
      const hub = this.addAccount({ id: `hub_${String(hubNo).padStart(2, '0')}`, bank: BANKS[(hubNo + 1) % 4], label: `Aggregation hub ${String(hubNo).padStart(2, '0')}`, age: 2, avg: 1000, risk: 0.91, archetype: 'smurf-hub' });
      const clusterId = `cluster_hub_${String(hubNo).padStart(2, '0')}`;
      const senders = [];
      for (let i = 0; i < 50; i++) {
        const sender = this.accounts[Math.floor(this.rand() * 10000)];
        senders.push(sender.id);
        this.addPayment({ from: sender.id, to: hub.id, amount: Math.round(this.number(850, 4900) / 10) * 10, t: this.now - 52 + i * 0.7, truth: 'fraud', pattern: clusterId, hour: 2.8 });
        this.syntheticFraudTransactions++;
      }
      this.addPayment({ from: hub.id, to: this.pick(this.merchants).id, amount: 49500, t: this.now - 4, truth: 'fraud', pattern: clusterId, hour: 2.9, bot: 1 });
      this.syntheticFraudTransactions++;
      this.clusterAccounts.set(clusterId, [hub.id, ...senders.slice(0, 12)]);
      this.registry.set(hub.id, { t: this.now - 90, why: 'Confirmed synthetic smurfing aggregator', source: 'seeded-risk-network' });
      hub.bl = true;
    }

    // Device farms: unrelated accounts converge on a shared device and pay a collector.
    for (let farmNo = 1; farmNo <= 15; farmNo++) {
      const collector = this.addAccount({ id: `collector_${String(farmNo).padStart(2, '0')}`, bank: BANKS[farmNo % 4], label: `Device farm collector ${String(farmNo).padStart(2, '0')}`, age: 4, avg: 1500, risk: 0.72, archetype: 'device-farm' });
      const device = this.addNode({ id: `farm_device_${String(farmNo).padStart(2, '0')}`, type: 'dev', bank: collector.bank, label: `Shared device ${String(farmNo).padStart(2, '0')}`, risk: 0.86, shared: true });
      const members = [collector.id];
      this.deviceAccounts.set(device.id, new Set());
      for (let i = 0; i < 12; i++) {
        const account = this.addAccount({ id: `farm_${String(farmNo).padStart(2, '0')}_${String(i + 1).padStart(2, '0')}`, bank: BANKS[(farmNo + i) % 4], label: `Farm ${farmNo}-${i + 1}`, age: 3 + this.rand() * 6, avg: 600, risk: 0.68, archetype: 'device-farm' });
        const oldDevice = account.homeDev;
        const oldLinks = this.linksByNode.get(account.id) || [];
        for (const link of oldLinks) { this.linkById.delete(link.id); this.linksByNode.set(link.b, (this.linksByNode.get(link.b) || []).filter(item => item.id !== link.id)); }
        this.links = this.links.filter(link => !oldLinks.some(item => item.id === link.id));
        this.linksByNode.set(account.id, []);
        this.deviceAccounts.delete(oldDevice);
        this.nodes.delete(oldDevice);
        this.devices = this.devices.filter(node => node.id !== oldDevice);
        account.homeDev = device.id;
        this.deviceAccounts.get(device.id).add(account.id);
        this.relation(account.id, device.id, 'dev', this.now - 45);
        members.push(account.id);
        this.addPayment({ from: account.id, to: collector.id, amount: Math.round(this.number(1400, 2900) / 10) * 10, t: this.now - 30 + i * 1.2, truth: 'fraud', pattern: `cluster_farm_${farmNo}`, hour: 11.5 });
        this.syntheticFraudTransactions++;
      }
      this.clusterAccounts.set(`cluster_farm_${String(farmNo).padStart(2, '0')}`, members);
    }

    // Historical account-takeover samples retain the home profile and evidence a new SIM/device.
    for (let i = 1; i <= 200; i++) {
      const victim = this.accounts[Math.floor(this.rand() * 10000)];
      const drop = this.addAccount({ id: `drop_${String(i).padStart(3, '0')}`, bank: BANKS[(i + 2) % 4], label: `Cash-out ${String(i).padStart(3, '0')}`, age: 1 + this.rand() * 5, avg: 700, risk: 0.8, archetype: 'sim-swap-drop' });
      const device = this.addNode({ id: `new_device_${String(i).padStart(3, '0')}`, type: 'dev', bank: victim.bank, label: 'Unrecognised device', risk: 0.95 });
      const sim = this.addNode({ id: `new_sim_${String(i).padStart(3, '0')}`, type: 'sim', bank: victim.bank, label: 'Recently changed SIM', risk: 0.95 });
      this.deviceAccounts.set(device.id, new Set([victim.id]));
      this.relation(victim.id, device.id, 'dev', this.now - 24);
      this.relation(victim.id, sim.id, 'sim', this.now - 24);
      this.addPayment({ from: victim.id, to: drop.id, amount: 49999, t: this.now - 23 + i * 0.01, truth: 'fraud', pattern: 'sim-swap', hour: 2.5, deviceId: device.id, simId: sim.id, jumpKm: 1148, jumpMin: 4, bot: 1 });
      this.syntheticFraudTransactions++;
      if (i <= 12) { drop.bl = true; this.registry.set(drop.id, { t: this.now - 20, why: 'Confirmed synthetic cash-out destination', source: 'seeded-risk-network' }); }
    }
  }

  account(id) { return this.nodes.get(id); }
  devCount(deviceId, fromBank, crossBank = true) {
    const owners = this.deviceAccounts.get(deviceId);
    if (!owners?.size) return 1;
    if (crossBank) return owners.size;
    return Math.max(1, [...owners].filter(id => this.nodes.get(id)?.bank === fromBank).length);
  }
  getOutgoing(id, since) { return (this.outgoing.get(id) || []).filter(edge => edge.t >= since); }

  graphAround(focusIds, { hops = 3, windowSeconds = 86400, maxNodes = 100, maxEdges = 180 } = {}) {
    const now = this.now, since = now - windowSeconds;
    const visited = new Set(focusIds), edgeIds = new Set(), relationIds = new Set();
    let frontier = [...focusIds];
    for (let depth = 0; depth < hops && frontier.length && visited.size < maxNodes; depth++) {
      const next = [];
      for (const id of frontier) {
        const incident = this.incident.get(id) || [];
        for (let i = incident.length - 1; i >= 0; i--) {
          const edge = incident[i];
          if (edge.t < since) continue;
          if (!edgeIds.has(edge.id) && edgeIds.size < maxEdges) edgeIds.add(edge.id);
          const other = edge.a === id ? edge.b : edge.a;
          if (!visited.has(other) && visited.size < maxNodes) { visited.add(other); next.push(other); }
        }
        for (const link of this.linksByNode.get(id) || []) {
          const other = link.a === id ? link.b : link.a;
          const shared = link.kind !== 'dev' || (this.deviceAccounts.get(other)?.size || 1) > 1;
          if (!shared && now - link.t > 20) continue;
          if (!relationIds.has(link.id)) relationIds.add(link.id);
          if (!visited.has(other) && visited.size < maxNodes) { visited.add(other); next.push(other); }
        }
      }
      frontier = next;
    }
    const nodes = [...visited].map(id => this.nodes.get(id)).filter(Boolean);
    const nodeSet = new Set(nodes.map(node => node.id));
    return {
      nodes,
      edges: [...edgeIds].map(id => this.transactionById.get(id)).filter(edge => edge && nodeSet.has(edge.a) && nodeSet.has(edge.b)),
      links: [...relationIds].map(id => this.linkById.get(id)).filter(link => link && nodeSet.has(link.a) && nodeSet.has(link.b)),
    };
  }

  graphCounts(focusIds, options = {}) { const view = this.graphAround(focusIds, options); return { nodes: view.nodes.length, payments: view.edges.length, relationships: view.links.length }; }
  transactionsForNode(id, limit = 12) { return (this.incident.get(id) || []).slice(-limit).reverse(); }
  search(query, limit = 8) {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return [...this.nodes.values()].filter(node => node.label.toLowerCase().includes(q) || node.id.toLowerCase().includes(q) || (node.vpa || '').toLowerCase().includes(q)).slice(0, limit);
  }
  networkSummary() {
    const clusters = [...this.clusterAccounts.keys()].length;
    return {
      transactionCount: this.transactions.length,
      accountCount: this.accounts.length,
      merchantCount: this.merchants.length,
      deviceCount: this.devices.length,
      bankCount: BANKS.length,
      clusterCount: clusters,
      fraudSamples: this.syntheticFraudTransactions,
      flaggedAccountCount: this.registry.size,
      defaultFocus: this.clusterAccounts.get('cluster_ring_01')?.[0] || this.accounts[0].id,
      seedName: 'TrustMesh synthetic UPI network v1',
    };
  }
  getRecentNetworkTransactions(limit = 30) { return this.transactions.slice(-limit).reverse(); }
  addScreenedTransaction(tx) { return this.addPayment(tx); }
  newId(prefix = 'evt') { return `${prefix}_${randomUUID().slice(0, 12)}`; }
}

module.exports = { TrustMeshStore, BANKS };
