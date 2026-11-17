package main

import (
	"encoding/json"
	"fmt"
	"math"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type TransactionGate struct{ contractapi.Contract }

// Evaluate applies the deterministic policy to an AI attestation before settlement.
// Model inference runs outside chaincode; endorsers validate the same signed result.
func (c *TransactionGate) Evaluate(ctx contractapi.TransactionContextInterface, raw string) (*RiskAttestation, error) {
	var a RiskAttestation
	if err := json.Unmarshal([]byte(raw), &a); err != nil {
		return nil, fmt.Errorf("invalid risk attestation: %w", err)
	}
	if a.TransactionID == "" || a.SenderHash == "" || a.ReceiverHash == "" || a.AmountPaise <= 0 {
		return nil, fmt.Errorf("transaction id, account hashes and positive amount are required")
	}
	if a.Verdict != "APPROVE" && a.Verdict != "HOLD" && a.Verdict != "BLOCK" {
		return nil, fmt.Errorf("unsupported verdict %q", a.Verdict)
	}
	for _, score := range []float64{a.TVP, a.Behavior, a.Graph} {
		if math.IsNaN(score) || score < 0 || score > 1 {
			return nil, fmt.Errorf("agent scores must be between 0 and 1")
		}
	}
	for _, accountHash := range []string{a.SenderHash, a.ReceiverHash} {
		blocked, err := ctx.GetStub().GetState("registry:" + accountHash)
		if err != nil {
			return nil, fmt.Errorf("read FraudRegistry: %w", err)
		}
		if blocked != nil {
			a.Verdict = "BLOCK"
			a.Reason = "Shared FraudRegistry pre-check"
			break
		}
	}
	if a.Reason != "Shared FraudRegistry pre-check" {
		maximum := math.Max(a.TVP, math.Max(a.Behavior, a.Graph))
		mean := (a.TVP + a.Behavior + a.Graph) / 3
		blended := 0.6*maximum + 0.4*mean
		expected := "APPROVE"
		if maximum > 0.85 {
			expected = "BLOCK"
		} else if blended > 0.6 {
			expected = "HOLD"
		}
		if a.Verdict != expected {
			return nil, fmt.Errorf("verdict %s does not match deterministic policy %s", a.Verdict, expected)
		}
	}
	prior, err := ctx.GetStub().GetState("payment:" + a.TransactionID)
	if err != nil {
		return nil, fmt.Errorf("check duplicate transaction: %w", err)
	}
	if prior != nil {
		return nil, fmt.Errorf("transaction %s has already been evaluated", a.TransactionID)
	}
	encoded, err := json.Marshal(a)
	if err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PutState("payment:"+a.TransactionID, encoded); err != nil {
		return nil, fmt.Errorf("write payment decision: %w", err)
	}
	txTime, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return nil, err
	}
	actorOrg, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return nil, err
	}
	record := AuditRecord{ID: a.TransactionID, TransactionID: a.TransactionID, Verdict: a.Verdict, Attestation: a,
		ActorOrg: actorOrg, CreatedAt: txTime.AsTime().UTC().Format("2006-01-02T15:04:05.999999999Z07:00")}
	auditJSON, err := json.Marshal(record)
	if err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PutState("audit:"+a.TransactionID, auditJSON); err != nil {
		return nil, fmt.Errorf("write AuditTrail decision: %w", err)
	}
	return &a, nil
}

func (c *TransactionGate) ReadDecision(ctx contractapi.TransactionContextInterface, transactionID string) (*RiskAttestation, error) {
	raw, err := ctx.GetStub().GetState("payment:" + transactionID)
	if err != nil {
		return nil, err
	}
	if raw == nil {
		return nil, fmt.Errorf("decision %s does not exist", transactionID)
	}
	var result RiskAttestation
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
