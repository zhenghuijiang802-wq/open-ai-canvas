package repository

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestSettleBillingOrderWithObservedCostFixedRequest(t *testing.T) {
	repo, db := newRefundedBillingRecoveryRepository(t)
	now := time.Now()

	// Initial user account: Available 10,000,000, Reserved 1,000,000
	if err := db.Create(&model.CreditAccount{
		UserID:               "user-fixed",
		AvailableMicrocredits: 10_000_000,
		ReservedMicrocredits:  1_000_000,
	}).Error; err != nil {
		t.Fatal(err)
	}

	// Order reserved 1,000,000 microcredits (fixed_request, multiplier 20,000 = 2.0x)
	order := &model.BillingOrder{
		ID:                         "order-fixed-1",
		UserID:                     "user-fixed",
		TaskID:                     "task-fixed-1",
		Model:                      "flux-schnell",
		Capability:                 "image",
		BillingMode:                "fixed_request",
		AmountMicrocredits:         1_000_000,
		ReservedAmountMicrocredits: 1_000_000,
		MultiplierBasisPoints:      20_000,
		Status:                     model.BillingStatusRunning,
		CreatedAt:                  now,
	}
	if err := db.Create(order).Error; err != nil {
		t.Fatal(err)
	}

	// Upstream API call returned cost = 0.40 CNY (400,000 micros)
	apiCall := &model.ApiCallLog{
		ID:                  "call-fixed-1",
		TaskID:              "task-fixed-1",
		UserID:              "user-fixed",
		Capability:          "image",
		Model:               "flux-schnell",
		Status:              model.ApiCallStatusSucceeded,
		CostAvailable:       true,
		EstimatedCostMicros: 400_000,
		Currency:            "CNY",
		CreatedAt:           now,
	}
	if err := db.Create(apiCall).Error; err != nil {
		t.Fatal(err)
	}

	// Settle the order
	if err := repo.SettleBillingOrder("order-fixed-1", "prov-req-1"); err != nil {
		t.Fatalf("SettleBillingOrder failed: %v", err)
	}

	// Verify order
	var settled model.BillingOrder
	if err := db.First(&settled, "id = ?", "order-fixed-1").Error; err != nil {
		t.Fatal(err)
	}
	// At 2.0x multiplier: 400,000 * 2.0 = 800,000 actual microcredits
	if settled.Status != model.BillingStatusSettled {
		t.Fatalf("Status = %s, want %s", settled.Status, model.BillingStatusSettled)
	}
	if settled.ActualAmountMicrocredits != 800_000 {
		t.Fatalf("ActualAmountMicrocredits = %d, want 800000", settled.ActualAmountMicrocredits)
	}
	if settled.ReservedAmountMicrocredits != 1_000_000 {
		t.Fatalf("ReservedAmountMicrocredits = %d, want 1000000", settled.ReservedAmountMicrocredits)
	}

	// Verify user account: reserved decreased by 1,000,000; refund of 200,000 added back to available
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user-fixed").Error; err != nil {
		t.Fatal(err)
	}
	if account.ReservedMicrocredits != 0 {
		t.Fatalf("ReservedMicrocredits = %d, want 0", account.ReservedMicrocredits)
	}
	if account.AvailableMicrocredits != 10_200_000 {
		t.Fatalf("AvailableMicrocredits = %d, want 10200000 (10M + 200k refund)", account.AvailableMicrocredits)
	}
}

func TestSettleBillingOrderWithObservedCostPerSecond(t *testing.T) {
	repo, db := newRefundedBillingRecoveryRepository(t)
	now := time.Now()

	// Initial user account: Available 10,000,000, Reserved 2,000,000
	if err := db.Create(&model.CreditAccount{
		UserID:               "user-second",
		AvailableMicrocredits: 10_000_000,
		ReservedMicrocredits:  2_000_000,
	}).Error; err != nil {
		t.Fatal(err)
	}

	// Order reserved 2,000,000 microcredits (per_second, multiplier 20,000 = 2.0x)
	order := &model.BillingOrder{
		ID:                         "order-second-1",
		UserID:                     "user-second",
		TaskID:                     "task-second-1",
		Model:                      "minimax_h3-768p",
		Capability:                 "video",
		BillingMode:                "per_second",
		AmountMicrocredits:         2_000_000,
		ReservedAmountMicrocredits: 2_000_000,
		MultiplierBasisPoints:      20_000,
		Status:                     model.BillingStatusRunning,
		CreatedAt:                  now,
	}
	if err := db.Create(order).Error; err != nil {
		t.Fatal(err)
	}

	// Upstream API call returned cost = 1.20 CNY (1,200,000 micros)
	apiCall := &model.ApiCallLog{
		ID:                  "call-second-1",
		TaskID:              "task-second-1",
		UserID:              "user-second",
		Capability:          "video",
		Model:               "minimax_h3-768p",
		Status:              model.ApiCallStatusSucceeded,
		CostAvailable:       true,
		EstimatedCostMicros: 1_200_000,
		Currency:            "CNY",
		CreatedAt:           now,
	}
	if err := db.Create(apiCall).Error; err != nil {
		t.Fatal(err)
	}

	// Settle the order
	if err := repo.SettleBillingOrder("order-second-1", "prov-req-2"); err != nil {
		t.Fatalf("SettleBillingOrder failed: %v", err)
	}

	// Verify order
	var settled model.BillingOrder
	if err := db.First(&settled, "id = ?", "order-second-1").Error; err != nil {
		t.Fatal(err)
	}
	// At 2.0x multiplier: 1,200,000 * 2.0 = 2,400,000 actual microcredits
	if settled.Status != model.BillingStatusSettled {
		t.Fatalf("Status = %s, want %s", settled.Status, model.BillingStatusSettled)
	}
	if settled.ActualAmountMicrocredits != 2_400_000 {
		t.Fatalf("ActualAmountMicrocredits = %d, want 2400000", settled.ActualAmountMicrocredits)
	}
	if settled.ReservedAmountMicrocredits != 2_000_000 {
		t.Fatalf("ReservedAmountMicrocredits = %d, want 2000000", settled.ReservedAmountMicrocredits)
	}

	// Verify user account: reserved 2M released; supplement of 400,000 deducted from available (10M - 400k = 9.6M)
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user-second").Error; err != nil {
		t.Fatal(err)
	}
	if account.ReservedMicrocredits != 0 {
		t.Fatalf("ReservedMicrocredits = %d, want 0", account.ReservedMicrocredits)
	}
	if account.AvailableMicrocredits != 9_600_000 {
		t.Fatalf("AvailableMicrocredits = %d, want 9600000", account.AvailableMicrocredits)
	}
}
