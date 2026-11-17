package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type AuditTrail struct{ contractapi.Contract }

func (c *AuditTrail) Append(ctx contractapi.TransactionContextInterface, raw string) error {
	var record AuditRecord
	if err := json.Unmarshal([]byte(raw), &record); err != nil {
		return fmt.Errorf("invalid audit record: %w", err)
	}
	if record.ID == "" || record.TransactionID == "" {
		return fmt.Errorf("audit id and transaction id are required")
	}
	if record.ActorOrg == "" {
		actorOrg, err := ctx.GetClientIdentity().GetMSPID()
		if err != nil {
			return err
		}
		record.ActorOrg = actorOrg
	}
	encoded, err := json.Marshal(record)
	if err != nil {
		return err
	}
	key := "audit:" + record.ID
	exists, err := ctx.GetStub().GetState(key)
	if err != nil {
		return err
	}
	if exists != nil {
		return fmt.Errorf("audit record %s already exists", record.ID)
	}
	return ctx.GetStub().PutState(key, encoded)
}

func (c *AuditTrail) Read(ctx contractapi.TransactionContextInterface, id string) (*AuditRecord, error) {
	raw, err := ctx.GetStub().GetState("audit:" + id)
	if err != nil {
		return nil, err
	}
	if raw == nil {
		return nil, fmt.Errorf("audit record %s does not exist", id)
	}
	var record AuditRecord
	if err := json.Unmarshal(raw, &record); err != nil {
		return nil, err
	}
	return &record, nil
}
