package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type FraudRegistry struct{ contractapi.Contract }

type RegistryEntry struct {
	AccountHash string `json:"accountHash"`
	Reason      string `json:"reason"`
	ReporterOrg string `json:"reporterOrg"`
	CreatedAt   string `json:"createdAt"`
}

func (c *FraudRegistry) Register(ctx contractapi.TransactionContextInterface, accountHash, reason string) error {
	if accountHash == "" || reason == "" {
		return fmt.Errorf("account hash and reason are required")
	}
	txTime, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return err
	}
	reporterOrg, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return err
	}
	entry := RegistryEntry{AccountHash: accountHash, Reason: reason, ReporterOrg: reporterOrg, CreatedAt: txTime.AsTime().UTC().Format("2006-01-02T15:04:05.999999999Z07:00")}
	encoded, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState("registry:"+accountHash, encoded)
}

func (c *FraudRegistry) Check(ctx contractapi.TransactionContextInterface, accountHash string) (*RegistryEntry, error) {
	raw, err := ctx.GetStub().GetState("registry:" + accountHash)
	if err != nil {
		return nil, err
	}
	if raw == nil {
		return nil, nil
	}
	var entry RegistryEntry
	if err := json.Unmarshal(raw, &entry); err != nil {
		return nil, err
	}
	return &entry, nil
}
