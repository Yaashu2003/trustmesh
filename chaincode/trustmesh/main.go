package main

import (
	"log"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func main() {
	cc, err := contractapi.NewChaincode(&TransactionGate{}, &FraudRegistry{}, &AuditTrail{})
	if err != nil {
		log.Fatalf("create TrustMesh chaincode: %v", err)
	}
	if err := cc.Start(); err != nil {
		log.Fatalf("start TrustMesh chaincode: %v", err)
	}
}
