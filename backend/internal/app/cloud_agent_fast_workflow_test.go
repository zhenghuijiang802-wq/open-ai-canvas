package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCloudAgentCanvasGetStateDetailSummaryAndFull(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	longSource := strings.Repeat("第一幕分镜正文设定", 120)
	doc := map[string]any{
		"nodes": []map[string]any{
			{
				"id":       "comic-1",
				"type":     "text",
				"title":    "漫画剧本",
				"position": map[string]any{"x": 20, "y": 20},
				"width":    320,
				"metadata": map[string]any{
					"content": longSource,
					"comic": map[string]any{
						"sourceText": longSource,
					},
				},
			},
		},
		"connections": []any{},
	}
	raw, _ := json.Marshal(doc)
	if err := db.Model(&model.CanvasProject{}).Where("id = ? AND user_id = ?", "agent-canvas", "user").Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	state := &cloudAgentRuntime{Request: CloudAgentRequest{CanvasID: "agent-canvas"}}

	badCall := cloudAgentCall{ID: "get-bad"}
	badCall.Function.Name = "canvas_get_state"
	badCall.Function.Arguments = `{"detail":"full"}`
	if _, err := cloudAgentHandleCanvasGetState(s.repo, "user", state, badCall, s); err == nil {
		t.Fatal("expected detail=full without nodeIds/focusNodeIds to be rejected")
	}

	summaryCall := cloudAgentCall{ID: "get-summary"}
	summaryCall.Function.Name = "canvas_get_state"
	summaryCall.Function.Arguments = `{"nodeIds":["comic-1"],"detail":"summary"}`
	summaryRes, err := cloudAgentHandleCanvasGetState(s.repo, "user", state, summaryCall, s)
	if err != nil {
		t.Fatal(err)
	}
	summaryMap := summaryRes.(map[string]any)
	nodes := summaryMap["nodes"].([]map[string]any)
	if len(nodes) != 1 {
		t.Fatalf("unexpected node count: %d", len(nodes))
	}
	summaryMeta := nodes[0]["metadata"].(map[string]any)
	if utf8.RuneCountInString(stringValue(summaryMeta["content"])) >= utf8.RuneCountInString(longSource) {
		t.Fatalf("summary detail did not bound content length: %d", utf8.RuneCountInString(stringValue(summaryMeta["content"])))
	}
	comicSummary := summaryMeta["comic"].(map[string]any)
	if utf8.RuneCountInString(stringValue(comicSummary["sourceExcerpt"])) > 210 {
		t.Fatalf("summary detail exceeded sourceExcerpt bound: %d", utf8.RuneCountInString(stringValue(comicSummary["sourceExcerpt"])))
	}

	fullCall := cloudAgentCall{ID: "get-full"}
	fullCall.Function.Name = "canvas_get_state"
	fullCall.Function.Arguments = `{"nodeIds":["comic-1"],"detail":"full"}`
	fullRes, err := cloudAgentHandleCanvasGetState(s.repo, "user", state, fullCall, s)
	if err != nil {
		t.Fatal(err)
	}
	fullNodes := fullRes.(map[string]any)["nodes"].([]map[string]any)
	fullMeta := fullNodes[0]["metadata"].(map[string]any)
	if stringValue(fullMeta["content"]) != longSource {
		t.Fatal("full detail did not preserve complete node content")
	}
}

func TestCloudAgentMediaDefaultsAppliedWhenOmitted(t *testing.T) {
	s, _, base := agentMediaFixture(t)
	state := &cloudAgentRuntime{
		Request: CloudAgentRequest{
			CanvasID:       "agent-canvas",
			PermissionMode: "auto",
			MediaDefaults: &CloudAgentMediaDefaults{
				Video: &CloudAgentMediaSettings{
					ChannelID:       "channel",
					ChannelModelKey: "seedance-test",
					Size:            "9:16",
					Quality:         "720p",
				},
			},
		},
	}
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	a := cloudAgentMediaArgs{
		Mode:         "video",
		Prompt:       "由默认配置补全",
		NodeID:       "video-default-1",
		Title:        "默认参数视频",
		SnapshotHash: base.SnapshotHash,
	}
	raw, _ := json.Marshal(a)
	if err := s.resolveCloudAgentMediaConfiguration(&a, state, string(raw), doc, map[string]any{}); err != nil {
		t.Fatal(err)
	}
	if a.ChannelID != "channel" || a.ChannelModelKey != "seedance-test" || a.Size != "9:16" {
		t.Fatalf("expected MediaDefaults to populate omitted model/size, got channel=%q key=%q size=%q", a.ChannelID, a.ChannelModelKey, a.Size)
	}

	explicit := a
	explicit.Size = "16:9"
	explicitRaw, _ := json.Marshal(explicit)
	if err := s.resolveCloudAgentMediaConfiguration(&explicit, state, string(explicitRaw), doc, map[string]any{}); err != nil {
		t.Fatal(err)
	}
	if explicit.Size != "16:9" {
		t.Fatalf("explicit size should not be overwritten by defaults, got %q", explicit.Size)
	}
}

func TestCloudAgentApprovalSwitchToAutoPersistsDefaultsAndFlipsMode(t *testing.T) {
	s, _, a := agentMediaFixture(t)
	s.closeApprovedCloudAgentMediaWaiters()
	run, state := agentMediaRun(t, s, a, "request_approval", "switch-to-auto-key")
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil || waiting.Approval == nil {
		t.Fatalf("expected waiting approval, got err=%v approval=%+v", err, waiting)
	}
	override := &CloudAgentMediaSettings{
		ChannelID:       "channel",
		ChannelModelKey: "seedance-test",
		Size:            "9:16",
	}
	if err := s.DecideCloudAgentApprovalWithOptions("user", run.ID, waiting.Approval.ID, "approve", "", CloudAgentApprovalDecisionOptions{
		MediaSettings: override,
		SwitchToAuto:  true,
	}); err != nil {
		t.Fatal(err)
	}

	updatedView, err := s.CloudAgentRun("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updatedView.PermissionMode != "auto" {
		t.Fatalf("expected run permissionMode to switch to auto, got %q", updatedView.PermissionMode)
	}

	stored, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	updatedState, err := cloudAgentDecode(stored)
	if err != nil {
		t.Fatal(err)
	}
	if updatedState.Request.PermissionMode != "auto" {
		t.Fatalf("expected persisted permissionMode auto, got %q", updatedState.Request.PermissionMode)
	}
	if updatedState.Request.MediaDefaults == nil || updatedState.Request.MediaDefaults.Video == nil || updatedState.Request.MediaDefaults.Video.Size != "9:16" {
		t.Fatalf("expected confirmed video settings saved into MediaDefaults: %+v", updatedState.Request.MediaDefaults)
	}
	foundSwitchedEvent := false
	for _, ev := range updatedState.Events {
		if ev.Type == "approval_decided" && ev.Payload["switchedToAuto"] == true && ev.Payload["permissionMode"] == "auto" {
			foundSwitchedEvent = true
			break
		}
	}
	if !foundSwitchedEvent {
		t.Fatal("expected approval_decided event to record switchedToAuto=true")
	}
	if prompt := cloudAgentApprovalResumePrompt(&updatedState); !strings.Contains(prompt, "自动模式") {
		t.Fatalf("expected resume prompt to note auto mode transition, got %q", prompt)
	}
}

func TestCloudAgentParallelMediaBatchQueuesAndSettlesConcurrently(t *testing.T) {
	s, db, base := agentMediaFixture(t)
	s.closeApprovedCloudAgentMediaWaiters()

	req := agentTestRequest()
	req.IdempotencyKey = "parallel-batch-key"
	req.PermissionMode = "auto"
	req.MediaExecutionMode = "parallel"
	req.Budget.MaxCredits = 1000
	req.Budget.MaxGenerationTasks = 3
	req.Budget.MaxVideoSeconds = 40
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}

	first := base
	first.NodeID = "parallel-video-1"
	first.Title = "并行镜头1"
	firstCall := agentMediaCall(first)
	firstCall.ID = "parallel-call-1"

	second := base
	second.NodeID = "parallel-video-2"
	second.Title = "并行镜头2"
	secondCall := agentMediaCall(second)
	secondCall.ID = "parallel-call-2"

	state.ActiveTaskID = ""
	state.Calls = []cloudAgentCall{firstCall, secondCall}
	state.CallIndex = 0
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)

	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}

	run, state = agentInterjectionState(t, s, run.ID)
	if state.MediaTaskID != "" || state.CallIndex != 0 {
		t.Fatalf("expected parallel batch to keep MediaTaskID empty and CallIndex=0 before settlement, got media=%q index=%d", state.MediaTaskID, state.CallIndex)
	}
	if len(state.ParallelMediaTasks) != 2 {
		t.Fatalf("expected 2 queued ParallelMediaTasks, got %d (%+v)", len(state.ParallelMediaTasks), state.ParallelMediaTasks)
	}

	for i, pt := range state.ParallelMediaTasks {
		resID := fmt.Sprintf("parallel-out-%d", i+1)
		if err := db.Create(&model.Resource{ID: resID, UserID: "user", Kind: "video", Status: "ready", MimeType: "video/mp4"}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&model.Task{}).Where("id = ?", pt.TaskID).Updates(map[string]any{
			"status":      model.TaskStatusSucceeded,
			"result_json": fmt.Sprintf(`{"mode":"video","video":{"storageKey":"resource:%s"}}`, resID),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := s.settleCloudAgentParallelMedia("user", run.ID, firstCall.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.settleCloudAgentParallelMedia("user", run.ID, secondCall.ID); err != nil {
		t.Fatal(err)
	}

	_, settled := agentInterjectionState(t, s, run.ID)
	if len(settled.ParallelMediaTasks) != 0 || settled.CallIndex != 2 {
		t.Fatalf("expected all parallel media tasks settled, got pending=%d callIndex=%d", len(settled.ParallelMediaTasks), settled.CallIndex)
	}
	for _, callID := range []string{firstCall.ID, secondCall.ID} {
		content, ok := cloudAgentToolMessage(&settled, callID)
		if !ok || !strings.Contains(content, `"assetReady":true`) {
			t.Fatalf("expected tool result for %s with assetReady=true, got ok=%v content=%s", callID, ok, content)
		}
	}

	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	for _, nodeID := range []string{first.NodeID, second.NodeID} {
		meta, _ := nodes[nodeID]["metadata"].(map[string]any)
		if stringValue(meta["status"]) != "success" {
			t.Fatalf("expected node %s written back with status=success, got %#v", nodeID, meta["status"])
		}
	}
}

func TestCloudAgentParallelMediaBatchRespectsTaskBudgetWithoutAbortingSubmitted(t *testing.T) {
	s, _, base := agentMediaFixture(t)
	s.closeApprovedCloudAgentMediaWaiters()

	req := agentTestRequest()
	req.IdempotencyKey = "parallel-budget-cap-key"
	req.PermissionMode = "auto"
	req.MediaExecutionMode = "parallel"
	req.Budget.MaxCredits = 1000
	req.Budget.MaxGenerationTasks = 1
	req.Budget.MaxVideoSeconds = 40
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, _ := s.repo.CloudAgent("user", root.ID)
	state, _ := cloudAgentDecode(run)

	first := base
	first.NodeID = "cap-video-1"
	c1 := agentMediaCall(first)
	c1.ID = "cap-call-1"

	second := base
	second.NodeID = "cap-video-2"
	c2 := agentMediaCall(second)
	c2.ID = "cap-call-2"

	state.ActiveTaskID = ""
	state.Calls = []cloudAgentCall{c1, c2}
	state.CallIndex = 0
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)

	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	_, after := agentInterjectionState(t, s, run.ID)
	if len(after.ParallelMediaTasks) != 1 || after.ParallelMediaTasks[0].CallID != c1.ID {
		t.Fatalf("expected only first task admitted within budget, got %+v", after.ParallelMediaTasks)
	}
}
