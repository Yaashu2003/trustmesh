'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '../..');

class LedgerError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'LedgerError';
    this.statusCode = 503;
    this.code = 'DRUNIX_UNAVAILABLE';
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

class DrunixClient {
  constructor() {
    this.mode = (process.env.TRUSTMESH_DRUNIX_MODE || 'required').toLowerCase();
    if (!['required', 'off'].includes(this.mode)) throw new Error('TRUSTMESH_DRUNIX_MODE must be required or off.');
    this.networkDir = process.env.DRUNIX_TEST_NETWORK || path.join(ROOT, 'drunix-platform', 'drunix-network', 'test-network');
    this.channel = process.env.DRUNIX_CHANNEL || 'mychannel';
    this.chaincode = process.env.DRUNIX_CHAINCODE || 'trustmesh';
    this.lastVerifiedAt = null;
    this.lastTransactionId = null;
  }

  get enabled() { return this.mode === 'required'; }

  publicStatus() {
    return {
      provider: 'DRUNIX',
      mode: this.mode,
      enabled: this.enabled,
      channel: this.channel,
      chaincode: this.chaincode,
      lastVerifiedAt: this.lastVerifiedAt,
      lastTransactionId: this.lastTransactionId,
    };
  }

  async linuxPath(input) {
    if (process.platform !== 'win32' || input.startsWith('/')) return input;
    const { stdout } = await execFileAsync('wsl.exe', ['wslpath', '-a', input], { timeout: 10000, windowsHide: true });
    return stdout.trim();
  }

  async shellConfig() {
    let networkDir = this.networkDir;
    if (process.platform === 'win32' && !networkDir.startsWith('/')) networkDir = await this.linuxPath(networkDir);
    const buildDir = path.posix.resolve(networkDir, '../..', 'build', 'bin');
    const configDir = path.posix.resolve(networkDir, '../config');
    if (process.platform === 'linux' && !fs.existsSync(path.join(networkDir, 'scripts', 'envVar.sh'))) {
      throw new LedgerError(`DRUNIX test-network scripts were not found at ${networkDir}.`);
    }
    const init = [
      'set -euo pipefail',
      `cd ${shellQuote(networkDir)}`,
      `export PATH=${shellQuote(buildDir)}:"$PATH"`,
      `export TEST_NETWORK_HOME=${shellQuote(networkDir)}`,
      `export FABRIC_CFG_PATH=${shellQuote(configDir)}`,
      "export OVERRIDE_ORG='' VERBOSE=false",
      'set +u',
      'source scripts/envVar.sh',
      'set -euo pipefail',
      'setGlobals 1 0',
    ];
    return init.join('; ');
  }

  async runPeer(command) {
    const script = `${await this.shellConfig()}; ${command}`;
    const executable = process.platform === 'win32' ? 'wsl.exe' : 'bash';
    const args = process.platform === 'win32' ? ['--exec', 'bash', '-lc', script] : ['-lc', script];
    try {
      const { stdout, stderr } = await execFileAsync(executable, args, {
        cwd: ROOT,
        timeout: Number(process.env.DRUNIX_COMMAND_TIMEOUT_MS || 45000),
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        env: process.env,
      });
      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error) {
      const detail = (error.stderr || error.stdout || error.message || 'Unknown peer CLI error').trim();
      throw new LedgerError(`DRUNIX submission failed: ${detail.slice(-1400)}`, error);
    }
  }

  async query(functionName, args) {
    const input = JSON.stringify({ Args: [functionName, ...args] });
    const command = `peer chaincode query -C ${shellQuote(this.channel)} -n ${shellQuote(this.chaincode)} -c ${shellQuote(input)}`;
    const { stdout } = await this.runPeer(command);
    const objectStart = stdout.indexOf('{'), objectEnd = stdout.lastIndexOf('}');
    const raw = objectStart >= 0 && objectEnd >= objectStart ? stdout.slice(objectStart, objectEnd + 1) : stdout;
    try { return JSON.parse(raw); }
    catch (error) { throw new LedgerError(`DRUNIX query returned invalid JSON: ${stdout.slice(0, 500)}`, error); }
  }

  async invoke(functionName, args) {
    const input = JSON.stringify({ Args: [functionName, ...args] });
    const command = `peer chaincode invoke -o localhost:7050 -C ${shellQuote(this.channel)} -n ${shellQuote(this.chaincode)} -c ${shellQuote(input)} --tls --cafile "$ORDERER_CA" --peerAddresses localhost:7051 --tlsRootCertFiles "$PEER0_ORG1_CA" --peerAddresses localhost:9051 --tlsRootCertFiles "$PEER0_ORG2_CA"`;
    return this.runPeer(command);
  }

  async queryWithRetry(functionName, args) {
    let lastError;
    for (let attempt = 0; attempt < 20; attempt++) {
      try { return await this.query(functionName, args); }
      catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    throw new LedgerError(`DRUNIX commit was not readable after 10 seconds: ${lastError?.message || 'query failed'}`, lastError);
  }

  async waitForEvidence(transactionId, auditId, verdict) {
    let lastError;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const [decision, audit] = await Promise.all([
          this.query('TransactionGate:ReadDecision', [transactionId]),
          this.query('AuditTrail:Read', [auditId]),
        ]);
        if (decision.transactionId === transactionId && decision.verdict === verdict &&
            audit.transactionId === transactionId && audit.verdict === verdict) return { decision, audit };
        lastError = new Error(`Ledger still reports ${decision.verdict}; audit reports ${audit.verdict}.`);
      } catch (error) { lastError = error; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new LedgerError(`DRUNIX commit evidence for ${transactionId} was not confirmed: ${lastError?.message || 'readback mismatch'}`, lastError);
  }

  async commitDecision(result) {
    if (!this.enabled) return { verified: false, mode: 'off', provider: 'DRUNIX' };
    const attestation = {
      transactionId: result.id,
      senderHash: `sha256:${createHash('sha256').update(result.from).digest('hex')}`,
      receiverHash: `sha256:${createHash('sha256').update(result.to).digest('hex')}`,
      amountPaise: Math.round(result.amount * 100),
      verdict: result.verdict,
      tvp: result.agents.tvp.score,
      behavior: result.agents.behavior.score,
      graph: result.agents.graph.score,
      reason: result.reason,
      issuerOrg: 'Org1MSP',
      createdAt: result.at,
    };

    await this.invoke('TransactionGate:Evaluate', [JSON.stringify(attestation)]);
    const [decision, audit] = await Promise.all([
      this.queryWithRetry('TransactionGate:ReadDecision', [result.id]),
      this.queryWithRetry('AuditTrail:Read', [result.id]),
    ]);
    if (decision.transactionId !== result.id || !['APPROVE', 'HOLD', 'BLOCK'].includes(decision.verdict) ||
        audit.transactionId !== result.id || audit.verdict !== decision.verdict) {
      throw new LedgerError(`DRUNIX did not confirm the decision and audit record for ${result.id}.`);
    }
    this.lastVerifiedAt = new Date().toISOString();
    this.lastTransactionId = result.id;
    return {
      provider: 'DRUNIX', mode: 'required', verified: true,
      channel: this.channel, chaincode: this.chaincode,
      transactionId: result.id, verdict: decision.verdict,
      reason: decision.reason, auditId: audit.id, actorOrg: audit.actorOrg,
      verifiedAt: this.lastVerifiedAt,
    };
  }

  async resolveHold(item, verdict, reason) {
    if (!this.enabled) return { verified: false, mode: 'off', provider: 'DRUNIX' };
    const receiverHash = `sha256:${createHash('sha256').update(item.to).digest('hex')}`;
    const reviewAuditId = `${item.id}:review`;
    const current = await this.queryWithRetry('TransactionGate:ReadDecision', [item.id]);
    if (current.verdict === 'HOLD') {
      try { await this.invoke('TransactionGate:ResolveHold', [item.id, verdict, reason]); }
      catch (error) {
        const alreadyCommitted = await this.query('TransactionGate:ReadDecision', [item.id]).catch(() => null);
        if (alreadyCommitted?.verdict !== verdict) throw error;
      }
    } else if (current.verdict !== verdict) {
      throw new LedgerError(`DRUNIX decision ${item.id} is already ${current.verdict}; it cannot be resolved as ${verdict}.`);
    }
    const { decision, audit } = await this.waitForEvidence(item.id, reviewAuditId, verdict);
    this.lastVerifiedAt = new Date().toISOString();
    this.lastTransactionId = item.id;
    return {
      provider: 'DRUNIX', mode: 'required', verified: true,
      channel: this.channel, chaincode: this.chaincode,
      transactionId: item.id, verdict,
      reason: decision.reason, auditId: audit.id, actorOrg: audit.actorOrg,
      receiverHash, verifiedAt: this.lastVerifiedAt,
    };
  }
}

module.exports = { DrunixClient, LedgerError };
