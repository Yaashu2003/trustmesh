const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = n => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const num = n => Number(n || 0).toLocaleString('en-IN');
const short = s => (s || '').length > 18 ? `${s.slice(0, 8)}…${s.slice(-5)}` : (s || '—');
const state = { focus: '', tab: 'decisions', graph: null, selected: null, searchTimer: 0, searchResults: [] };
async function api(url, options) { const response = await fetch(url, options); const data = await response.json(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); return data; }
function toast(message) { const element = $('#toast'); element.textContent = message; element.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), 2800); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]); }
function renderOverview(o) {
  $('#dataset-count').textContent = `${num(o.transactionCount)} payments indexed`;
  $('#metric-transactions').textContent = num(o.transactionCount);
  $('#metric-accounts').textContent = num(o.accountCount);
  $('#metric-screened').textContent = num(o.counters.screened);
  $('#metric-blocked').textContent = num(o.counters.blocked);
  $('#metric-stopped-amount').textContent = `${money(o.counters.stoppedAmount)} protected`;
  $('#review-tab-count').textContent = o.reviewCount;
}
function setOptions(results) {
  const list = $('#accounts-list'); list.replaceChildren();
  for (const item of results) { const option = document.createElement('option'); option.value = item.id; option.label = `${item.label} · ${item.bank} · ${item.vpa || item.type}`; list.append(option); }
}
function colorFor(n) { if (n.type === 'merch') return '#42a88a'; if (n.type === 'dev' || n.type === 'sim') return '#9b8aca'; const risk = Number(n.risk || 0); return risk > .72 ? '#d65467' : risk > .38 ? '#e8a54c' : '#718bb7'; }
function layoutNodes(data, width, height) {
  const nodes = data.nodes, focus = nodes.find(n => n.id === data.focus) || nodes[0];
  const cx = width / 2, cy = height / 2, pos = new Map();
  if (!focus) return pos;
  pos.set(focus.id, { x: cx, y: cy });
  const linked = new Map();
  for (const e of [...data.edges, ...data.relationships]) { const a=linked.get(e.source)||[]; a.push(e.target); linked.set(e.source,a); const b=linked.get(e.target)||[]; b.push(e.source); linked.set(e.target,b); }
  const groups = new Map(); let queue = [focus.id], seen = new Set(queue);
  while (queue.length) { const next=[]; for (const id of queue) for (const other of linked.get(id)||[]) if (!seen.has(other)) {seen.add(other);next.push(other); } queue=next; }
  const remaining = nodes.filter(n => n.id !== focus.id), isPeripheral = n => ['dev','sim'].includes(n.type);
  const core = remaining.filter(n => !isPeripheral(n)), peripheral = remaining.filter(isPeripheral);
  const radius = Math.min(width*.39, height*.40), banks = ['SBI','HDFC','ICICI','Axis'];
  const bankCenter = { SBI:[cx-width*.22,cy-height*.20], HDFC:[cx+width*.22,cy-height*.20], ICICI:[cx-width*.22,cy+height*.20], Axis:[cx+width*.22,cy+height*.20] };
  const bankCounts = new Map();
  for (let i=0;i<core.length;i++) { const n=core[i], bank=n.bank||'SBI', center=bankCenter[bank]||[cx,cy], count=bankCounts.get(bank)||0; bankCounts.set(bank,count+1); const angle=count*2.39996, r=28+Math.sqrt(count)*16; pos.set(n.id,{x:Math.max(20,Math.min(width-20,center[0]+Math.cos(angle)*r)),y:Math.max(22,Math.min(height-24,center[1]+Math.sin(angle)*r))}); }
  for (let i=0;i<peripheral.length;i++) { const n=peripheral[i], related=(linked.get(n.id)||[]).map(id=>pos.get(id)).find(Boolean), a=i*2.4; pos.set(n.id,related?{x:Math.max(12,Math.min(width-12,related.x+Math.cos(a)*30)),y:Math.max(14,Math.min(height-14,related.y+Math.sin(a)*28))}:{x:cx+Math.cos(a)*radius,y:cy+Math.sin(a)*radius}); }
  return pos;
}
function renderGraph(data) {
  state.graph=data; state.focus=data.focus;
  const svg=$('#knowledge-graph'), wrap=$('#graph-wrap'), box=wrap.getBoundingClientRect(), width=Math.max(360,box.width), height=box.height;
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`); svg.replaceChildren();
  const pos=layoutNodes(data,width,height), ns='http://www.w3.org/2000/svg', defs=document.createElementNS(ns,'defs'), marker=document.createElementNS(ns,'marker');
  marker.setAttribute('id','arrow');marker.setAttribute('viewBox','0 0 8 8');marker.setAttribute('refX','7');marker.setAttribute('refY','4');marker.setAttribute('markerWidth','5');marker.setAttribute('markerHeight','5');marker.setAttribute('orient','auto'); const arrow=document.createElementNS(ns,'path');arrow.setAttribute('d','M 0 0 L 8 4 L 0 8 z');arrow.setAttribute('fill','#6c8ee8');marker.append(arrow);defs.append(marker);svg.append(defs);
  const edgeLayer=document.createElementNS(ns,'g');
  const drawEdge=(e,kind)=>{const a=pos.get(e.source),b=pos.get(e.target);if(!a||!b)return; const path=document.createElementNS(ns,'path');path.setAttribute('d',`M ${a.x} ${a.y} L ${b.x} ${b.y}`);path.setAttribute('class',kind==='payment'?`edge-payment ${e.truth==='fraud'?'fraud':''}`:'edge-identity');if(kind==='payment')path.setAttribute('marker-end','url(#arrow)');path.setAttribute('data-tip',kind==='payment'?`${money(e.amount)} · ${e.verdict||'historical'}`:`${e.kind==='dev'?'Shared device':'SIM association'}`);edgeLayer.append(path);};
  for(const edge of data.relationships)drawEdge(edge,'relationship'); for(const edge of data.edges)drawEdge(edge,'payment'); svg.append(edgeLayer);
  const nodeLayer=document.createElementNS(ns,'g');
  for(const n of data.nodes){const p=pos.get(n.id);if(!p)continue;const g=document.createElementNS(ns,'g');g.setAttribute('class',`node ${state.selected===n.id?'selected':''}`);g.setAttribute('transform',`translate(${p.x},${p.y})`);g.dataset.id=n.id;
    const isEntity=n.type==='acct'||n.type==='merch';
    if(n.flagged||n.risk>.84){const halo=document.createElementNS(ns,'circle');halo.setAttribute('r',n.id===data.focus?17:11);halo.setAttribute('class','risk-halo');g.append(halo);}
    let shape;if(n.type==='merch'){shape=document.createElementNS(ns,'rect');shape.setAttribute('x','-6');shape.setAttribute('y','-6');shape.setAttribute('width','12');shape.setAttribute('height','12');shape.setAttribute('rx','2');}else{shape=document.createElementNS(ns,'circle');shape.setAttribute('r',n.id===data.focus?9:isEntity?6:4.7);}
    shape.setAttribute('fill',colorFor(n));g.append(shape);
    if(n.id===data.focus){const ring=document.createElementNS(ns,'circle');ring.setAttribute('r','13');ring.setAttribute('fill','none');ring.setAttribute('stroke','#2f57c2');ring.setAttribute('stroke-width','1.2');g.append(ring);}
    if(n.id===data.focus||isEntity){const label=document.createElementNS(ns,'text');label.setAttribute('x','10');label.setAttribute('y','3');label.setAttribute('class','node-label');label.textContent=(n.label||n.id).slice(0,22);g.append(label);}
    g.addEventListener('click',()=>inspect(n.id)); g.addEventListener('mouseenter',ev=>showTip(ev,n));g.addEventListener('mouseleave',hideTip);nodeLayer.append(g);
  }
  svg.append(nodeLayer);
  $('#graph-stats').textContent=`${num(data.counts.nodes)} nodes · ${num(data.counts.payments)} payments · ${num(data.counts.relationships)} identity links`;
  $('#graph-empty').hidden=true; $('#focus-caption').textContent=`Network around ${data.center}`;
}
let tip;
function showTip(ev,n){hideTip();tip=document.createElementNS('http://www.w3.org/2000/svg','title');tip.textContent=`${n.label} · ${n.bank||n.type} · risk ${Math.round((n.risk||0)*100)}%`;ev.currentTarget.append(tip);}
function hideTip(){if(tip){tip.remove();tip=null;}}
async function loadGraph(focus=state.focus,depth=$('#graph-depth').value){try{const data=await api(`/api/graph?focus=${encodeURIComponent(focus||'')}&hops=${depth}`);renderGraph(data);}catch(e){toast(e.message);}}
function riskPct(v){return `${Math.round(Number(v||0)*100)}%`;}
async function inspect(id){state.selected=id;try{const n=await api(`/api/entities/${encodeURIComponent(id)}`);$('#focus-caption').textContent=`${n.label} · ${n.bank||n.type} · ${n.id}`;$('#entity-strip').innerHTML=`<div class="entity-detail"><strong>${escapeHtml(n.label)}</strong><span class="entity-id">${escapeHtml(n.id)}</span><span class="entity-risk">Risk ${riskPct(n.risk)}${n.flagged?' · registry flagged':''}</span></div><div class="entity-actions"><button data-use="from">Use as sender</button>${n.type==='merch'?'':'<button data-use="to">Use as payee</button>'}</div>`;$('#entity-strip').querySelector('[data-use="from"]')?.addEventListener('click',()=>{$('#sender').value=n.id;toast(`${n.label} set as sender`)});$('#entity-strip').querySelector('[data-use="to"]')?.addEventListener('click',()=>{$('#receiver').value=n.id;toast(`${n.label} set as payee`)});if(n.type==='acct'){setOptions([{id:n.id,label:n.label,bank:n.bank,vpa:n.vpa,type:n.type},...state.searchResults]);$('#sender').value=$('#sender').value||n.id;}state.selected=id;}catch(e){toast(e.message);}}
const verdictClass=v=>v==='APPROVE'?'approve':v==='HOLD'?'hold':'block';
function table(headers,rows){return `<table class="data-table"><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td class="empty-row" colspan="${headers.length}">Nothing to show yet.</td></tr>`}</tbody></table>`;}
function decisionRow(d){const date=new Date(d.at);return `<tr><td class="mono">${date.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</td><td><button class="entity-link" data-entity="${escapeHtml(d.from)}">${escapeHtml(d.fromLabel||short(d.from))}</button></td><td><button class="entity-link" data-entity="${escapeHtml(d.to)}">${escapeHtml(d.toLabel||short(d.to))}</button></td><td class="mono">${money(d.amount)}</td><td><span class="pill ${verdictClass(d.verdict)}">${d.verdict}</span></td><td class="mono">${riskPct(d.score)}</td><td>${escapeHtml(d.status||d.reason||'')}</td></tr>`;}
async function loadTable(){const el=$('#table-container');try{if(state.tab==='decisions'){const d=await api('/api/transactions?limit=30');$('#decision-tab-count').textContent=d.decisions.length;el.innerHTML=table(['TIME','SENDER','PAYEE','AMOUNT','DECISION','RISK','SETTLEMENT STATUS'],d.decisions.map(decisionRow));}
  else if(state.tab==='reviews'){const d=await api('/api/reviews');$('#review-tab-count').textContent=d.reviews.length;el.innerHTML=table(['TIME','SENDER','PAYEE','AMOUNT','RISK','REASONS','ACTION'],d.reviews.map(row=>`<tr><td class="mono">${new Date(row.at).toLocaleTimeString('en-IN')}</td><td>${escapeHtml(row.fromLabel)}</td><td>${escapeHtml(row.toLabel)}</td><td class="mono">${money(row.amount)}</td><td class="mono">${riskPct(row.score)}</td><td>${escapeHtml(row.reasons.join('; ')||row.reason)}</td><td><div class="review-actions"><button class="small-button allow" data-review="${row.id}" data-action="approve">Approve</button><button class="small-button" data-review="${row.id}" data-action="reject">Reject</button></div></td></tr>`));}
  else if(state.tab==='registry'){const d=await api('/api/registry');el.innerHTML=table(['ENTITY','BANK','REASON','SOURCE','FIRST FLAGGED'],d.records.map(r=>`<tr><td><button class="entity-link" data-entity="${escapeHtml(r.id)}">${escapeHtml(r.label)} <span class="mono">${escapeHtml(r.id)}</span></button></td><td>${escapeHtml(r.bank||'—')}</td><td>${escapeHtml(r.reason)}</td><td>${escapeHtml(r.source)}</td><td class="mono">${new Date(r.at).toLocaleString('en-IN')}</td></tr>`));}
  else if(state.tab==='ledger'){const d=await api('/api/blocks');el.innerHTML=table(['HEIGHT','TIME','TRANSACTION','AMOUNT','PREVIOUS HASH','BLOCK HASH'],d.blocks.map(r=>`<tr><td class="mono">#${num(r.height)}</td><td class="mono">${new Date(r.at).toLocaleString('en-IN')}</td><td class="mono">${escapeHtml(r.transactionId)}</td><td class="mono">${money(r.amount)}</td><td class="mono">${escapeHtml((r.previousHash||'').slice(0,16))}…</td><td class="mono">${escapeHtml((r.hash||'').slice(0,20))}…</td></tr>`));}
  else {const d=await api('/api/audit');el.innerHTML=table(['SEQ','TIME','TRANSACTION','SENDER','PAYEE','AMOUNT','DECISION','HASH'],d.records.map(r=>`<tr><td class="mono">${r.sequence}</td><td class="mono">${new Date(r.at).toLocaleTimeString('en-IN')}</td><td class="mono">${escapeHtml(short(r.transactionId))}</td><td class="mono">${escapeHtml(short(r.from))}</td><td class="mono">${escapeHtml(short(r.to))}</td><td class="mono">${money(r.amount)}</td><td><span class="pill ${verdictClass(r.verdict)}">${r.verdict}</span></td><td class="mono">${escapeHtml((r.hash||'').slice(0,16))}…</td></tr>`));}
  el.querySelectorAll('[data-entity]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.entity;loadGraph(id);inspect(id);}));
  el.querySelectorAll('[data-review]').forEach(b=>b.addEventListener('click',()=>review(b.dataset.review,b.dataset.action)));
}catch(e){el.textContent=e.message;}}
async function refresh(){try{renderOverview(await api('/api/overview'));await loadTable();}catch(e){toast(e.message);}}
async function review(id,action){try{const result=await api(action==='approve'?`/api/reviews/${encodeURIComponent(id)}`:'/api/reviews/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});toast(`Transaction ${result.verdict.toLowerCase()}d after review`);await refresh();}catch(e){toast(e.message);}}
async function resolveEntity(value){const q=value.trim();if(!q)return null;const d=await api(`/api/search?q=${encodeURIComponent(q)}`);state.searchResults=d.results;setOptions(d.results);return d.results.find(n=>n.id.toLowerCase()===q.toLowerCase()||n.vpa?.toLowerCase()===q.toLowerCase()||n.label.toLowerCase()===q.toLowerCase())||null;}
$('#screen-form').addEventListener('submit',async ev=>{ev.preventDefault();const button=$('#screen-button');button.disabled=true;button.firstElementChild.textContent='Screening…';try{let from=$('#sender').value, to=$('#receiver').value;const [fromMatch,toMatch]=await Promise.all([resolveEntity(from),resolveEntity(to)]);if(fromMatch)from=fromMatch.id;if(toMatch)to=toMatch.id;const result=await api('/api/transactions/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({from,to,amount:$('#amount').value,newDevice:$('#new-device').checked,newSim:$('#new-sim').checked,impossibleTravel:$('#impossible-travel').checked,scriptedInput:$('#scripted-input').checked})});toast(`${result.verdict}: ${result.reason}`);state.tab='decisions';$$('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab==='decisions'));await loadGraph(result.from,2);await inspect(result.from);await refresh();}catch(e){toast(e.message);}finally{button.disabled=false;button.firstElementChild.textContent='Screen transaction';}});
$('#entity-search').addEventListener('input',ev=>{clearTimeout(state.searchTimer);const query=ev.target.value.trim();if(query.length<2){$('#graph-empty').hidden=true;return;}state.searchTimer=setTimeout(async()=>{try{const d=await api(`/api/search?q=${encodeURIComponent(query)}`);state.searchResults=d.results;setOptions(d.results);if(d.results.length){$('#graph-empty').hidden=true;await loadGraph(d.results[0].id);}else{$('#graph-empty').hidden=false;$('#graph-empty').textContent='No matching accounts, merchants, or VPAs.';}}catch(e){toast(e.message);}},220);});
$('#entity-search').addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();const item=state.searchResults[0];if(item){loadGraph(item.id);inspect(item.id);}}if((ev.metaKey||ev.ctrlKey)&&ev.key.toLowerCase()==='k'){ev.preventDefault();ev.currentTarget.focus();}});
$('#graph-depth').addEventListener('change',()=>loadGraph());$('#network-home').addEventListener('click',()=>{state.selected=null;loadGraph('');$('#entity-strip').innerHTML='<span class="entity-placeholder">Select a node to inspect its activity and risk evidence.</span>';});$('#refresh-data').addEventListener('click',refresh);
$$('.tab').forEach(tab=>tab.addEventListener('click',()=>{state.tab=tab.dataset.tab;$$('.tab').forEach(t=>t.classList.toggle('active',t===tab));loadTable();}));
window.addEventListener('resize',()=>{if(state.graph)renderGraph(state.graph);});
Promise.all([api('/api/overview'),api('/api/graph')]).then(([overviewData,graphData])=>{renderOverview(overviewData);renderGraph(graphData);state.focus=graphData.focus;}).catch(e=>toast(e.message));
loadTable();setInterval(()=>{refresh();},12000);
