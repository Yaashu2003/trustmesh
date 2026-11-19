const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { TrustMeshStore } = require('./server/data-store.cjs');
const { scoreTransactionPattern } = require('./server/agents/transaction-pattern.cjs');
const { scoreBehavior } = require('./server/agents/behavioral-biometric.cjs');
const { scoreGraph } = require('./server/agents/graph-network.cjs');
const { orchestrate } = require('./server/agents/orchestrator.cjs');
const { KeyDBStore } = require('./server/storage/keydb.cjs');

const ROOT = __dirname, PORT = Number(process.env.PORT || 4173);
const TARGET = Math.max(1000, Math.min(500000, Number(process.env.TRUSTMESH_TRANSACTIONS || 300000)));
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const store = new TrustMeshStore(TARGET), profileCache = new KeyDBStore();
const auditPath = path.join(DATA, 'audit.jsonl'), registryPath = path.join(DATA, 'registry.jsonl'), blockPath = path.join(DATA, 'blocks.jsonl');
let counters = { screened: 0, approved: 0, held: 0, blocked: 0, stoppedAmount: 0 };
let previousHash = '0'.repeat(64), sequence = 0;
const recentDecisions = [], reviewQueue = [];

const agents = [
  { id: 'tvp', name: 'Transaction Pattern', description: 'Amount, velocity, and time-of-day deviations' },
  { id: 'behavior', name: 'Behavioral Biometric', description: 'Known device/SIM, device sharing, and travel speed' },
  { id: 'graph', name: 'Graph Network', description: 'Cross-bank cycles, fan-in, shared devices, and propagation' },
];
const sigmoid = x => 1 / (1 + Math.exp(-x)), logit = p => Math.log(Math.min(.999, Math.max(.001, p)) / (1 - Math.min(.999, Math.max(.001, p))));
const iso = seconds => new Date(seconds * 1000).toISOString();
function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(value)); }
async function readBody(req) { let raw = ''; for await (const c of req) { raw += c; if (raw.length > 1_000_000) throw new Error('Request too large'); } try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Body must be valid JSON'); } }
function persist(file, value) { fs.appendFileSync(file, JSON.stringify(value) + '\n'); }
function addAudit(entry) { const base = { sequence: ++sequence, at: new Date().toISOString(), ...entry, previousHash }; const hash = createHash('sha256').update(JSON.stringify(base)).digest('hex'); const record = { ...base, hash }; previousHash = hash; persist(auditPath, record); return record; }
function snapshotDecision(d) { return { id: d.id, at: d.at, from: d.from, to: d.to, fromLabel: d.fromLabel, toLabel: d.toLabel, amount: d.amount, verdict: d.verdict, score: d.score, reason: d.reason, status: d.status }; }
function viewNode(n) { return { id: n.id, type: n.type, bank: n.bank, label: n.label, vpa: n.vpa, risk: n.risk, age: n.age, average: n.avg, archetype: n.archetype || null, flagged: !!n.bl, shared: !!n.shared }; }
function overview() { return { ...store.networkSummary(), counters, reviewCount: reviewQueue.length, agents, environment: 'Synthetic development network', persistence: 'Local append-only JSONL audit, registry, and block records', generatedAt: iso(store.now) }; }
function graph(focus, hops = 2) {
  const actualFocus = store.account(focus) ? focus : store.networkSummary().defaultFocus;
  const data = store.graphAround([actualFocus], { hops: Math.max(1, Math.min(4, hops)), windowSeconds: 86400, maxNodes: 70, maxEdges: 110 });
  const nodes = data.nodes.map(viewNode);
  const focusNode = store.account(actualFocus);
  return { focus: actualFocus, nodes, edges: data.edges.map(e => ({ id: e.id, source: e.a, target: e.b, kind: 'payment', amount: e.amt, at: iso(e.t), verdict: e.v, truth: e.truth, pattern: e.pattern })), relationships: data.links.map(e => ({ id: e.id, source: e.a, target: e.b, kind: e.kind, at: iso(e.t) })), counts: { nodes: nodes.length, payments: data.edges.length, relationships: data.links.length }, center: focusNode?.label || actualFocus };
}
function entity(id) {
  const node = store.account(id); if (!node) return null;
  return { ...viewNode(node), homeDevice: node.homeDev, homeSim: node.homeSim, registry: store.registry.get(id) || null,
    transactions: store.transactionsForNode(id, 14).map(e => ({ id: e.id, from: e.a, to: e.b, fromLabel: store.account(e.a)?.label || e.a, toLabel: store.account(e.b)?.label || e.b, amount: e.amt, at: iso(e.t), verdict: e.v, truth: e.truth, pattern: e.pattern })) };
}
function graphContext(from, to) {
  const view = store.graphAround([from, to], { hops: 4, windowSeconds: 86400, maxNodes: 450, maxEdges: 1800 });
  const nodes = new Map(view.nodes.map(n => [n.id, n]));
  const edges = view.edges.map(e => ({ ...e, ghost: false }));
  const links = view.links.map(e => ({ ...e, kind: e.kind === 'dev' ? 'dev' : e.kind }));
  const S = { now: store.now, nodes, edges, links, m: { yb: 0 } };
  return { S, graphStore: { recentEdges: (now, win, eligible) => edges.filter(e => now - e.t < win && eligible(e)) } };
}
function screen(input) {
  const sender = store.account(String(input.from || '')), receiver = store.account(String(input.to || ''));
  if (!sender || sender.type !== 'acct') throw new Error('Choose a valid sender account ID.');
  if (!receiver || !['acct', 'merch'].includes(receiver.type)) throw new Error('Choose a valid account or merchant payee ID.');
  const amount = Number(input.amount); if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) throw new Error('Amount must be between ₹1 and ₹1,00,00,000.');
  const now = Date.now() / 1000, amountRupees = Math.round(amount), hour = Number.isFinite(Number(input.hour)) ? Number(input.hour) : new Date().getHours();
  const deviceId = input.newDevice ? `device_new_${randomUUID().slice(0, 8)}` : sender.homeDev;
  const simId = input.newSim ? `sim_new_${randomUUID().slice(0, 8)}` : sender.homeSim;
  const jumpKm = input.impossibleTravel ? 1150 : Number(input.jumpKm || 0), jumpMin = input.impossibleTravel ? 4 : Number(input.jumpMin || 60);
  if (input.newDevice && !store.nodes.has(deviceId)) store.addNode({ id: deviceId, type: 'dev', bank: sender.bank, label: 'Unrecognised device', risk: .92 });
  if (input.newSim && !store.nodes.has(simId)) store.addNode({ id: simId, type: 'sim', bank: sender.bank, label: 'Recently changed SIM', risk: .92 });
  if (input.newDevice) { store.deviceAccounts.set(deviceId, new Set([sender.id])); store.relation(sender.id, deviceId, 'dev', now); }
  if (input.newSim) store.relation(sender.id, simId, 'sim', now);
  const tx = { id: store.newId('screen'), from: sender.id, to: receiver.id, amt: amountRupees, t: now, hour, dev: deviceId, sim: simId, jumpKm, jumpMin, bot: input.scriptedInput ? 1 : 0, ghost: false };
  const outgoing = store.getOutgoing(sender.id, now - 120);
  const tvp = scoreTransactionPattern(tx, sender, outgoing, now);
  const behavior = scoreBehavior(tx, sender, store.devCount(deviceId, sender.bank));
  const { S, graphStore } = graphContext(sender.id, receiver.id);
  if (!S.nodes.has(deviceId)) S.nodes.set(deviceId, store.nodes.get(deviceId));
  if (!S.nodes.has(simId)) S.nodes.set(simId, store.nodes.get(simId));
  const graphResult = scoreGraph(tx, S, { graph: true, share: true }, { WIN: 90, sigmoid, logit, devCount: (id, bank) => store.devCount(id, bank), graphStore });
  const knownFlag = store.registry.has(sender.id) || store.registry.has(receiver.id);
  const decision = orchestrate({ tvp: knownFlag ? 1 : tvp.score, behavior: behavior.score, graph: graphResult.score });
  const verdict = decision.verdict;
  const reasons = [...new Set([...(knownFlag ? ['Sender or payee is listed in the shared fraud registry'] : []), ...tvp.reasons, ...behavior.reasons, ...graphResult.reasons])];
  const result = { id: tx.id, at: new Date().toISOString(), from: sender.id, to: receiver.id, fromLabel: sender.label, toLabel: receiver.label, amount: amountRupees, verdict, score: Math.round(decision.score * 1000) / 1000, blendedScore: Math.round(decision.blended * 1000) / 1000, reason: decision.reason, reasons, agents: { tvp: { score: tvp.score, reasons: tvp.reasons }, behavior: { score: behavior.score, reasons: behavior.reasons }, graph: { score: graphResult.score, reasons: graphResult.reasons, subgraph: graphResult.subgraph, messagePassing: graphResult.messagePassing } }, graphEvidence: graphResult, status: verdict === 'APPROVE' ? 'Committed to local DRUNIX ledger' : verdict === 'HOLD' ? 'Awaiting analyst review' : 'Stopped before settlement' };
  counters.screened++; counters[verdict.toLowerCase()]++; if (verdict === 'BLOCK') counters.stoppedAmount += amountRupees;
  if (verdict === 'APPROVE') {
    const txEdge = store.addScreenedTransaction({ id: tx.id, from: tx.from, to: tx.to, amount: amountRupees, t: now, truth: 'unknown', hour, deviceId, simId, jumpKm, jumpMin, bot: tx.bot, verdict });
    const block = { height: counters.approved, transactionId: txEdge.id, amount: amountRupees, at: result.at, previousHash, hash: createHash('sha256').update(`${previousHash}|${txEdge.id}|${amountRupees}|${now}`).digest('hex') };
    previousHash = block.hash; persist(blockPath, block); result.block = block;
  } else if (verdict === 'BLOCK') {
    const registryRecord = { id: receiver.id, reason: reasons.join('; ') || decision.reason, source: 'TrustMesh risk orchestrator', at: result.at, transactionId: tx.id };
    store.registry.set(receiver.id, { t: now, why: registryRecord.reason, source: registryRecord.source }); persist(registryPath, registryRecord);
  } else reviewQueue.unshift({ ...result, status: 'Pending review' });
  result.audit = addAudit({ transactionId: tx.id, from: sender.id, to: receiver.id, amount: amountRupees, verdict, score: result.score, reasons });
  recentDecisions.unshift(snapshotDecision(result)); if (recentDecisions.length > 150) recentDecisions.length = 150;
  profileCache.set(sender.id, { lastScreenedAt: result.at, lastVerdict: verdict });
  return result;
}
function sendStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname), file = path.resolve(ROOT, 'public', `.${requested}`), base = path.resolve(ROOT, 'public') + path.sep;
  if (!file.startsWith(base)) return json(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (e, content) => { if (e) return json(res, 404, { error: 'Not found' }); const ext = path.extname(file).toLowerCase(), types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' }; res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' }); res.end(content); });
}
const app = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`), p = url.pathname;
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' }); return res.end(); }
    if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok: true, service: 'trustmesh-workbench', uptime: process.uptime() });
    if (req.method === 'GET' && p === '/api/overview') return json(res, 200, overview());
    if (req.method === 'GET' && p === '/api/graph') return json(res, 200, graph(url.searchParams.get('focus') || '', Number(url.searchParams.get('hops') || 2)));
    if (req.method === 'GET' && p === '/api/search') return json(res, 200, { results: store.search(url.searchParams.get('q') || '', 12).map(viewNode) });
    if (req.method === 'GET' && p.startsWith('/api/entities/')) { const result = entity(decodeURIComponent(p.slice('/api/entities/'.length))); return result ? json(res, 200, result) : json(res, 404, { error: 'Entity not found' }); }
    if (req.method === 'GET' && p === '/api/transactions') return json(res, 200, { decisions: recentDecisions.slice(0, Math.min(100, Number(url.searchParams.get('limit') || 30))) });
    if (req.method === 'GET' && p === '/api/registry') return json(res, 200, { records: [...store.registry].map(([id, r]) => ({ id, label: store.account(id)?.label || id, bank: store.account(id)?.bank, reason: r.why, source: r.source, at: iso(r.t) })).slice(-100).reverse() });
    if (req.method === 'GET' && p === '/api/audit') { const rows = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).slice(-100).reverse().map(line => JSON.parse(line)) : []; return json(res, 200, { records: rows }); }
    if (req.method === 'GET' && p === '/api/blocks') { const rows = fs.existsSync(blockPath) ? fs.readFileSync(blockPath, 'utf8').trim().split('\n').filter(Boolean).slice(-100).reverse().map(line => JSON.parse(line)) : []; return json(res, 200, { blocks: rows }); }
    if (req.method === 'GET' && p === '/api/reviews') return json(res, 200, { reviews: reviewQueue.slice(0, 100) });
    if (req.method === 'POST' && p === '/api/transactions/analyze') return json(res, 200, screen(await readBody(req)));
    if (req.method === 'POST' && p.startsWith('/api/reviews/')) {
      const id = decodeURIComponent(p.slice('/api/reviews/'.length)), i = reviewQueue.findIndex(row => row.id === id); if (i < 0) return json(res, 404, { error: 'Review item not found' });
      const [item] = reviewQueue.splice(i, 1); item.status = 'Analyst approved'; item.verdict = 'APPROVE'; counters.held = Math.max(0, counters.held - 1); counters.approved++;
      const reviewedSender = store.account(item.from);
      store.addScreenedTransaction({ id: item.id, from: item.from, to: item.to, amount: item.amount, t: Date.now() / 1000, truth: 'unknown', hour: new Date().getHours(), deviceId: reviewedSender?.homeDev, simId: reviewedSender?.homeSim, verdict: 'APPROVE' });
      const block = { height: counters.approved, transactionId: item.id, amount: item.amount, at: new Date().toISOString(), previousHash, hash: createHash('sha256').update(`${previousHash}|${item.id}|${item.amount}|review`).digest('hex') }; previousHash = block.hash; persist(blockPath, block);
      item.block = block; item.audit = addAudit({ transactionId: item.id, from: item.from, to: item.to, amount: item.amount, verdict: 'APPROVE', review: 'analyst-approved' }); return json(res, 200, item);
    }
    if (req.method === 'POST' && p === '/api/reviews/reject') { const body = await readBody(req), i = reviewQueue.findIndex(row => row.id === body.id); if (i < 0) return json(res, 404, { error: 'Review item not found' }); const [item] = reviewQueue.splice(i, 1); item.status = 'Rejected by analyst'; item.verdict = 'BLOCK'; counters.held = Math.max(0, counters.held - 1); counters.blocked++; counters.stoppedAmount += item.amount; store.registry.set(item.to, { t: Date.now() / 1000, why: 'Analyst rejected held transaction', source: 'TrustMesh analyst review' }); persist(registryPath, { id: item.to, reason: 'Analyst rejected held transaction', source: 'TrustMesh analyst review', at: new Date().toISOString() }); item.audit = addAudit({ transactionId: item.id, from: item.from, to: item.to, amount: item.amount, verdict: 'BLOCK', review: 'analyst-rejected' }); return json(res, 200, item); }
    if (req.method === 'GET' && p.startsWith('/api/')) return json(res, 404, { error: 'API route not found' });
    return sendStatic(res, p);
  } catch (error) { return json(res, 400, { error: error.message || 'Request failed' }); }
});
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`TrustMesh workbench listening at http://${HOST}:${PORT} (${store.transactions.length.toLocaleString()} synthetic transactions)`));
