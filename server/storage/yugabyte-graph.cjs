class YugabyteGraphStore {
  constructor() { this.nodes = new Map(); this.edges = []; this.queries = 0; }
  reset(nodes = []) { this.nodes = new Map(nodes.map(node => [node.id, structuredClone(node)])); this.edges = []; this.queries = 0; }
  upsertNode(node) { this.nodes.set(node.id, structuredClone(node)); }
  addPayment(edge) { this.edges.push(structuredClone(edge)); if (this.edges.length > 10000) this.edges.splice(0, this.edges.length - 8000); }
  recentEdges(now, windowSeconds, eligible = () => true) {
    this.queries++;
    return this.edges.filter(edge => now - edge.t < windowSeconds && !edge.ghost && eligible(edge));
  }
  neighborhood(startIds, maxHops = 2, since = -Infinity) {
    this.queries++;
    const visited = new Set(startIds), frontier = new Set(startIds), selectedEdges = [];
    for (let hop = 0; hop < maxHops; hop++) {
      const next = new Set();
      for (const edge of this.edges) {
        if (edge.t < since || edge.ghost) continue;
        if (frontier.has(edge.a) || frontier.has(edge.b)) {
          selectedEdges.push(edge);
          if (!visited.has(edge.a)) next.add(edge.a);
          if (!visited.has(edge.b)) next.add(edge.b);
        }
      }
      next.forEach(id => visited.add(id));
      frontier.clear(); next.forEach(id => frontier.add(id));
    }
    return { nodes: [...visited].map(id => this.nodes.get(id)).filter(Boolean), edges: selectedEdges, hops: maxHops };
  }
  stats() { return { nodes: this.nodes.size, edges: this.edges.length, queries: this.queries, mode: 'in-memory development adapter' }; }
}

module.exports = { YugabyteGraphStore };
