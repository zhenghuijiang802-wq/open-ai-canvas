package app

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestCloudAgentCanvasReadExposesOnlyControlledComicFields(t *testing.T) {
	doc := map[string]any{"nodes": []any{
		map[string]any{"id": "source", "type": "text", "metadata": map[string]any{
			"content": "A short original story.", "apiKey": "PRIVATE_SENTINEL",
			"comic": map[string]any{"version": 1, "role": "source", "settings": map[string]any{
				"style": "ink", "aspectRatio": "3:4", "panelCount": "auto", "storyType": "mystery", "emotionTone": "suspense", "narrativePreset": "cinematic_single_panel", "private": "PRIVATE_SENTINEL",
				"styleSelection": map[string]any{"id": "ink-style", "title": "水墨", "coverUrl": "/api/resources/style-image/file", "referenceResourceId": "style-image", "apiKey": "PRIVATE_SENTINEL"},
			}, "derivationTaskId": "PRIVATE_SENTINEL"},
		}},
		map[string]any{"id": "asset", "type": "image", "metadata": map[string]any{
			"status": "idle", "private": "PRIVATE_SENTINEL",
			"comic": map[string]any{"version": 1, "role": "asset", "assetKind": "character", "order": 0, "private": "PRIVATE_SENTINEL"},
		}},
		map[string]any{"id": "panel", "type": "image", "metadata": map[string]any{
			"status": "idle", "comic": map[string]any{"version": 1, "role": "panel", "order": 1, "sourceExcerpt": "The hero enters.", "assetNodeIds": []string{"asset"}, "private": "PRIVATE_SENTINEL"},
		}},
	}, "connections": []any{}}
	for _, ids := range [][]string{nil, {"source", "asset", "panel"}} {
		view, err := cloudAgentCanvasState(nil, "user", "canvas", doc, 0, ids, 0)
		if err != nil {
			t.Fatal(err)
		}
		encoded, _ := json.Marshal(view)
		if strings.Contains(string(encoded), "PRIVATE_SENTINEL") || strings.Contains(string(encoded), "derivationTaskId") {
			t.Fatalf("comic read exposed private metadata: %s", encoded)
		}
		nodes := view.(map[string]any)["nodes"].([]any)
		if len(nodes) != 3 {
			t.Fatalf("missing comic nodes: %s", encoded)
		}
		for _, item := range nodes {
			node := item.(map[string]any)
			comic, ok := node["comic"].(map[string]any)
			if !ok || comic["role"] != node["id"] {
				t.Fatalf("lost comic role: %#v", node)
			}
			if comic["role"] == "source" {
				settings := comic["settings"].(map[string]any)
				if settings["panelCount"] != "auto" || settings["storyType"] != "mystery" || settings["emotionTone"] != "suspense" || settings["narrativePreset"] != "cinematic_single_panel" {
					t.Fatalf("Agent lost controlled creation settings: %#v", settings)
				}
				selection, ok := settings["styleSelection"].(map[string]any)
				if !ok || len(selection) != 4 || selection["id"] != "ink-style" || selection["referenceResourceId"] != "style-image" || selection["coverUrl"] != "/api/resources/style-image/file" {
					t.Fatalf("Agent lost the safe style identity/reference: %#v", settings)
				}
			}
		}
	}
}

func TestCloudAgentMediaDraftPreservesControlledComicMetadata(t *testing.T) {
	for _, role := range []string{"asset", "panel"} {
		t.Run(role, func(t *testing.T) {
			s, db, args := agentMediaFixture(t)
			comic := map[string]any{"version": 1, "role": role, "order": 1, "useUnifiedStyle": false, "promptStylePrefix": ""}
			workflowKind := "character"
			if role == "asset" {
				comic["assetKind"] = "character"
			} else {
				workflowKind = "shot"
				comic["sourceExcerpt"] = strings.Repeat("original ", 600)
				comic["assetNodeIds"] = []string{"hero", "cat"}
			}
			expected, _ := json.Marshal(comic)
			comic["private"] = "PRIVATE_SENTINEL"
			canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
			if err != nil {
				t.Fatal(err)
			}
			doc, _ := creationDocument(canvas.PayloadJSON)
			args.Mode, args.NodeID, args.DraftRunID = "image", "comic-draft", "comic-run"
			args.Duration, args.VideoGenerateAudio = 0, nil
			doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{
				"id": args.NodeID, "type": "image", "title": "Comic draft", "metadata": map[string]any{
					"status": "idle", "workflowKind": workflowKind, "comic": comic, "private": "PRIVATE_SENTINEL",
				},
			})
			raw, _ := json.Marshal(doc)
			if err := db.Model(canvas).Update("payload_json", string(raw)).Error; err != nil {
				t.Fatal(err)
			}
			// Exercise both approval draft creation and the later task submission.
			for _, task := range []*model.Task{nil, {ID: "comic-task", InputJSON: `{}`}} {
				canvas, _ = s.repo.CanvasProjectForUser("user", "agent-canvas")
				doc, _ = creationDocument(canvas.PayloadJSON)
				args.SnapshotHash = cloudAgentCanvasHash(doc)
				if err := createCloudAgentMediaNode(s.repo, "user", "agent-canvas", &cloudAgentMediaPlan{Args: args}, task, mustRuntimePolicy(t, s)); err != nil {
					t.Fatal(err)
				}
				canvas, _ = s.repo.CanvasProjectForUser("user", "agent-canvas")
				doc, _ = creationDocument(canvas.PayloadJSON)
				nodes, _ := creationObjects(doc["nodes"])
				metadata := nodes[args.NodeID]["metadata"].(map[string]any)
				actual, _ := json.Marshal(metadata["comic"])
				if !reflect.DeepEqual(actual, expected) || metadata["workflowKind"] != workflowKind || metadata["private"] != nil {
					t.Fatalf("comic draft lost its controlled identity or kept opaque metadata: %s", canvas.PayloadJSON)
				}
				if task != nil && metadata["taskId"] != task.ID {
					t.Fatal("comic preservation interfered with task binding")
				}
			}
		})
	}
}
