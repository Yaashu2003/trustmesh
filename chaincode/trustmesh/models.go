package main

type RiskAttestation struct {
	TransactionID string  `json:"transactionId"`
	SenderHash    string  `json:"senderHash"`
	ReceiverHash  string  `json:"receiverHash"`
	AmountPaise   int64   `json:"amountPaise"`
	Verdict       string  `json:"verdict"`
	TVP           float64 `json:"tvp"`
	Behavior      float64 `json:"behavior"`
	Graph         float64 `json:"graph"`
	Reason        string  `json:"reason"`
	IssuerOrg     string  `json:"issuerOrg"`
	CreatedAt     string  `json:"createdAt"`
}

type AuditRecord struct {
	ID            string          `json:"id"`
	TransactionID string          `json:"transactionId"`
	Verdict       string          `json:"verdict"`
	Attestation   RiskAttestation `json:"attestation"`
	ActorOrg      string          `json:"actorOrg"`
	CreatedAt     string          `json:"createdAt"`
}
