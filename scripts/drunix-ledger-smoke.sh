#!/usr/bin/env bash
set -euo pipefail

API_URL="${TRUSTMESH_API_URL:-http://127.0.0.1:4173}"
NETWORK_DIR="${DRUNIX_TEST_NETWORK:-$(pwd)}"
CHANNEL="${DRUNIX_CHANNEL:-mychannel}"
CHAINCODE="${DRUNIX_CHAINCODE:-trustmesh}"

cd "$NETWORK_DIR"
DRUNIX_ROOT="$(cd ../.. && pwd)"
export PATH="$DRUNIX_ROOT/build/bin:$PATH"
export FABRIC_CFG_PATH="$(pwd)/../config"
# DRUNIX's helper reads optional shell variables under nounset mode.
set +u
export OVERRIDE_ORG="${OVERRIDE_ORG:-}"
source scripts/envVar.sh
set -u

invoke_and_verify() {
  local label="$1" expected="$2" from="$3" to="$4" amount="$5" signals="$6"
  local request screened verdict txid tvp behavior graph reason sender_hash receiver_hash attestation invoke_json query_json audit_json decision audit

  request="$(jq -cn --arg from "$from" --arg to "$to" --argjson amount "$amount" --argjson signals "$signals" '$signals + {from:$from,to:$to,amount:$amount}')"
  screened="$(curl --fail --silent --show-error -X POST "$API_URL/api/transactions/analyze" -H 'content-type: application/json' --data "$request")"
  verdict="$(jq -r '.verdict' <<< "$screened")"
  txid="$(jq -r '.id' <<< "$screened")"
  tvp="$(jq -r '.agents.tvp.score' <<< "$screened")"
  behavior="$(jq -r '.agents.behavior.score' <<< "$screened")"
  graph="$(jq -r '.agents.graph.score' <<< "$screened")"
  reason="$(jq -r '.reason' <<< "$screened")"

  if [[ "$verdict" != "$expected" ]]; then
    echo "Unexpected TrustMesh verdict for $label: expected $expected, received $verdict" >&2
    jq . <<< "$screened" >&2
    return 1
  fi

  sender_hash="$(printf '%s' "$from" | sha256sum | cut -d ' ' -f1)"
  receiver_hash="$(printf '%s' "$to" | sha256sum | cut -d ' ' -f1)"
  attestation="$(jq -cn \
    --arg transactionId "$txid" \
    --arg senderHash "sha256:$sender_hash" \
    --arg receiverHash "sha256:$receiver_hash" \
    --arg verdict "$verdict" \
    --arg reason "$reason" \
    --arg issuerOrg Org1MSP \
    --argjson amountPaise "$((amount * 100))" \
    --argjson tvp "$tvp" \
    --argjson behavior "$behavior" \
    --argjson graph "$graph" \
    '{transactionId:$transactionId,senderHash:$senderHash,receiverHash:$receiverHash,amountPaise:$amountPaise,verdict:$verdict,tvp:$tvp,behavior:$behavior,graph:$graph,reason:$reason,issuerOrg:$issuerOrg}')"
  invoke_json="$(jq -cn --arg payload "$attestation" '{Args:["TransactionGate:Evaluate",$payload]}')"

  echo "Submitting $label ($txid) to DRUNIX as $verdict"
  setGlobals 1 1
  peer chaincode invoke -o localhost:7050 -C "$CHANNEL" -n "$CHAINCODE" -c "$invoke_json" \
    --tls --cafile "$ORDERER_CA" \
    --peerAddresses localhost:7051 --tlsRootCertFiles "$PEER0_ORG1_CA" \
    --peerAddresses localhost:9051 --tlsRootCertFiles "$PEER0_ORG2_CA"

  query_json="$(jq -cn --arg id "$txid" '{Args:["TransactionGate:ReadDecision",$id]}')"
  setGlobals 1 0
  decision="$(peer chaincode query -C "$CHANNEL" -n "$CHAINCODE" -c "$query_json")"
  jq -e --arg id "$txid" --arg expected "$expected" \
    '.transactionId == $id and .verdict == $expected' <<< "$decision" >/dev/null

  audit_json="$(jq -cn --arg id "$txid" '{Args:["AuditTrail:Read",$id]}')"
  audit="$(peer chaincode query -C "$CHANNEL" -n "$CHAINCODE" -c "$audit_json")"
  jq -e --arg id "$txid" --arg expected "$expected" \
    '.transactionId == $id and .verdict == $expected and .actorOrg == "Org1MSP"' <<< "$audit" >/dev/null

  printf '| %s | `%s` | `%s` → `%s` | ₹%s | **%s** | verified in payment state and AuditTrail |\n' \
    "$label" "$txid" "$from" "$to" "$amount" "$verdict" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  echo "Verified $txid in TransactionGate and AuditTrail: $verdict"
}

echo '## TrustMesh transactions committed to the DRUNIX test ledger' >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo '| Scenario | Transaction ID | Transfer | Amount | Verdict | Ledger check |' >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo '|---|---|---|---:|---|---|' >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

invoke_and_verify 'familiar-purchase' APPROVE acc_000001 mer_001 750 \
  '{"newDevice":false,"newSim":false,"impossibleTravel":false,"scriptedInput":false}'
invoke_and_verify 'device-and-sim-change' HOLD acc_000001 mer_001 1500 \
  '{"newDevice":true,"newSim":true,"impossibleTravel":false,"scriptedInput":false}'
invoke_and_verify 'mule-ring-transfer' BLOCK mule_01_a mule_01_b 9850 \
  '{"newDevice":true,"newSim":true,"impossibleTravel":true,"scriptedInput":true}'
