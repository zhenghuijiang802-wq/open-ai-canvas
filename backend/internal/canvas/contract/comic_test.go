package contract

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	"yingce/backend/internal/assets"
)

func TestComicNodeProjectionOnlyIncludesBoundedContractFields(t *testing.T) {
	settings := map[string]any{
		"style": strings.Repeat("画", 1001), "aspectRatio": strings.Repeat("9", 33),
		"panelCount": float64(24), "apiKey": "PRIVATE_SENTINEL",
	}
	node := map[string]any{"type": "text", "metadata": map[string]any{
		"private": "PRIVATE_SENTINEL",
		"comic": map[string]any{
			"version": float64(1), "role": "source", "settings": settings,
			"derivationTaskId": "PRIVATE_SENTINEL", "derivationOperationId": "PRIVATE_SENTINEL",
			"derivationFingerprint": "PRIVATE_SENTINEL", "derivationError": "PRIVATE_SENTINEL",
			"derivationStatus": "PRIVATE_SENTINEL", "unknown": "PRIVATE_SENTINEL",
		},
	}}
	projection := ComicNodeProjection(node)
	encoded, err := json.Marshal(projection)
	if err != nil || strings.Contains(string(encoded), "PRIVATE_SENTINEL") {
		t.Fatalf("projection leaked unrelated metadata: %s, %v", encoded, err)
	}
	got := projection["settings"].(map[string]any)
	if got["panelCount"] != 24 || utf8.RuneCountInString(got["style"].(string)) != 1000 ||
		utf8.RuneCountInString(got["aspectRatio"].(string)) != 32 || got["styleTruncated"] != true {
		t.Fatalf("unbounded settings: %#v", got)
	}
	if utf8.RuneCountInString(settings["style"].(string)) != 1001 {
		t.Fatal("read projection changed saved source settings")
	}

	ids := []any{"asset-0", "asset-0", "", " invalid", "bad\x00id", strings.Repeat("x", 161), map[string]any{"secret": "PRIVATE_SENTINEL"}}
	for i := 1; i < 35; i++ {
		ids = append(ids, fmt.Sprintf("asset-%d", i))
	}
	ids = append(ids, strings.Repeat("v", 126))
	panel := map[string]any{"type": "image", "metadata": map[string]any{"comic": map[string]any{
		"version": 1, "role": "panel", "order": 2, "sourceExcerpt": strings.Repeat("原", 4001), "assetNodeIds": ids,
	}}}
	projection = ComicNodeProjection(panel)
	if utf8.RuneCountInString(projection["sourceExcerpt"].(string)) != 4000 ||
		len(projection["assetNodeIds"].([]string)) != 30 || projection["assetNodeIdsTruncated"] != true {
		t.Fatalf("unbounded panel: %#v", projection)
	}
	preserved := ComicNodeMetadata(panel)
	if utf8.RuneCountInString(preserved["sourceExcerpt"].(string)) != 4001 || len(preserved["assetNodeIds"].([]string)) != 36 {
		t.Fatal("media metadata preservation must not use the truncated read view")
	}
}

func TestComicNodeMetadataRequiresKnownVersionRoleAndNodeType(t *testing.T) {
	for _, test := range []struct {
		name, nodeType, role string
		version              any
	}{
		{"future version", "text", "source", float64(2)},
		{"string version", "text", "source", "1"},
		{"unknown role", "text", "unknown", 1},
		{"image source", "image", "source", 1},
		{"text asset", "text", "asset", 1},
		{"video panel", "video", "panel", 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			node := map[string]any{"type": test.nodeType, "metadata": map[string]any{"comic": map[string]any{"version": test.version, "role": test.role}}}
			if ComicNodeMetadata(node) != nil {
				t.Fatal("invalid comic marker accepted")
			}
		})
	}
	for _, count := range []any{0, 25, 1.5, "2"} {
		node := map[string]any{"type": "text", "metadata": map[string]any{"comic": map[string]any{"version": 1, "role": "source", "settings": map[string]any{"panelCount": count}}}}
		if _, ok := ComicNodeProjection(node)["settings"].(map[string]any)["panelCount"]; ok {
			t.Fatalf("invalid panel count accepted: %v", count)
		}
	}
}

func TestComicNodeMetadataPreservesImageChoicesWithoutProviderConfiguration(t *testing.T) {
	defaults := map[string]any{
		"model": "channel:image-model", "size": "3:4", "quality": "high", "imageResolution": "2K",
		"transparentBackground": "false", "count": "1", "imageParameters": `{"seed":42,"detail":"high","enhance":false}`,
		"apiKey": "PRIVATE_SENTINEL", "baseUrl": "PRIVATE_SENTINEL", "channels": []any{"PRIVATE_SENTINEL"},
	}
	node := map[string]any{"type": "text", "metadata": map[string]any{"comic": map[string]any{
		"version": 1, "role": "source", "settings": map[string]any{"imageDefaults": defaults},
	}}}
	for _, project := range []func(map[string]any) map[string]any{ComicNodeMetadata, ComicNodeProjection} {
		got := project(node)["settings"].(map[string]any)["imageDefaults"].(map[string]any)
		if len(got) != 7 || got["imageParameters"] != defaults["imageParameters"] || got["transparentBackground"] != "false" || got["count"] != "1" {
			t.Fatalf("image choices were lost: %#v", got)
		}
		encoded, _ := json.Marshal(got)
		if strings.Contains(string(encoded), "PRIVATE_SENTINEL") {
			t.Fatalf("provider configuration leaked: %s", encoded)
		}
		got["quality"] = "low"
		if defaults["quality"] != "high" {
			t.Fatal("projection mutated persisted defaults")
		}
	}
	for _, role := range []string{"asset", "panel"} {
		for _, prefix := range []string{"", strings.Repeat("画", 1000)} {
			item := map[string]any{"type": "image", "metadata": map[string]any{"comic": map[string]any{
				"version": 1, "role": role, "useUnifiedStyle": false, "promptStylePrefix": prefix,
			}}}
			got := ComicNodeMetadata(item)
			if got["useUnifiedStyle"] != false || got["promptStylePrefix"] != prefix {
				t.Fatalf("false style choice or tracked empty prefix was lost: %#v", got)
			}
		}
	}
}

func TestComicNodeMetadataRejectsMalformedImageChoices(t *testing.T) {
	for index, test := range []struct {
		key   string
		value any
	}{
		{"model", strings.Repeat("m", 513)}, {"size", strings.Repeat("x", 65)}, {"quality", 1},
		{"imageResolution", strings.Repeat("x", 65)}, {"transparentBackground", "False"},
		{"count", "2"}, {"count", 1}, {"imageParameters", `null`}, {"imageParameters", `[]`},
		{"imageParameters", `{"nested":{"value":1}}`}, {"imageParameters", `{"null":null}`},
		{"imageParameters", `{"broken":}`}, {"imageParameters", strings.Repeat(" ", 32769)},
	} {
		t.Run(fmt.Sprintf("%s-%d", test.key, index), func(t *testing.T) {
			defaults := comicImageDefaults(map[string]any{test.key: test.value})
			if _, ok := defaults[test.key]; ok {
				t.Fatalf("malformed %s accepted: %#v", test.key, defaults)
			}
		})
	}
	item := map[string]any{"type": "image", "metadata": map[string]any{"comic": map[string]any{
		"version": 1, "role": "panel", "useUnifiedStyle": "false", "promptStylePrefix": strings.Repeat("画", 1001),
	}}}
	got := ComicNodeMetadata(item)
	if _, ok := got["useUnifiedStyle"]; ok {
		t.Fatal("string style toggle accepted")
	}
	if _, ok := got["promptStylePrefix"]; ok {
		t.Fatal("unbounded style marker accepted")
	}
}

func TestComicStyleSelectionPreservesOnlyStablePublicFields(t *testing.T) {
	for _, cover := range []string{"/comic-style-previews/ink_watercolor-1.webp", "/api/resources/style-reference_1/file"} {
		selection := map[string]any{
			"id": "custom-style", "title": "水彩线稿", "coverUrl": cover, "referenceResourceId": "style-reference_1",
			"apiKey": "PRIVATE_SENTINEL", "localPath": "PRIVATE_SENTINEL", "prompt": "PRIVATE_SENTINEL",
		}
		node := map[string]any{"id": "source", "type": "text", "metadata": map[string]any{"comic": map[string]any{
			"version": 1, "role": "source", "settings": map[string]any{"style": "独立保存的画风正文", "styleSelection": selection},
		}}}
		for _, project := range []func(map[string]any) map[string]any{ComicNodeMetadata, ComicNodeProjection} {
			settings := project(node)["settings"].(map[string]any)
			got := settings["styleSelection"].(map[string]any)
			if len(got) != 4 || got["id"] != "custom-style" || got["title"] != "水彩线稿" || got["coverUrl"] != cover || got["referenceResourceId"] != "style-reference_1" || settings["style"] != "独立保存的画风正文" {
				t.Fatalf("style selection lost public identity: %#v", settings)
			}
			encoded, _ := json.Marshal(got)
			if strings.Contains(string(encoded), "PRIVATE_SENTINEL") {
				t.Fatalf("style projection leaked opaque data: %s", encoded)
			}
			got["title"] = "changed"
			if selection["title"] != "水彩线稿" {
				t.Fatal("read projection mutated saved style selection")
			}
		}
	}
	if got := comicStyleSelection(map[string]any{"id": strings.Repeat("i", 200), "title": strings.Repeat("画", 200)}); got == nil || len(got) != 2 {
		t.Fatalf("valid maximum-length selection or absent optional fields rejected: %#v", got)
	}
}

func TestComicStyleSelectionRejectsUnsafeLocatorsAndMalformedIdentity(t *testing.T) {
	for index, test := range []struct {
		key   string
		value any
	}{
		{"id", ""}, {"id", strings.Repeat("i", 201)}, {"title", "   "}, {"title", strings.Repeat("画", 201)},
		{"title", "name\x00hidden"}, {"title", "name\nnext"}, {"id", 1}, {"title", true},
		{"coverUrl", "data:image/png;base64,PRIVATE_SENTINEL"}, {"coverUrl", "blob:https://example.invalid/private"},
		{"coverUrl", "https://example.invalid/api/resources/style-reference/file"}, {"coverUrl", "//example.invalid/api/resources/style-reference/file"},
		{"coverUrl", "/api/resources/style-reference/file?token=PRIVATE_SENTINEL"}, {"coverUrl", "/api/resources/style-reference/file#private"},
		{"coverUrl", "/api/resources/../secret/file"}, {"coverUrl", "/api/resources/a%2Fb/file"}, {"coverUrl", "/api/resources/a\\b/file"},
		{"coverUrl", "/comic-style-previews/../private.webp"}, {"coverUrl", "/comic-style-previews/one/two.webp"}, {"coverUrl", "/comic-style-previews/one.webp?secret=yes"},
		{"coverUrl", "/comic-style-previews/one.png"}, {"coverUrl", "/comic-style-previews/.webp"}, {"coverUrl", " /comic-style-previews/one.webp"},
		{"coverUrl", nil}, {"referenceResourceId", "../private"}, {"referenceResourceId", "resource:style"}, {"referenceResourceId", " padded"},
		{"referenceResourceId", strings.Repeat("x", 81)}, {"referenceResourceId", ""}, {"referenceResourceId", []string{"style"}},
	} {
		t.Run(fmt.Sprintf("%s-%d", test.key, index), func(t *testing.T) {
			selection := map[string]any{"id": "valid", "title": "Valid style"}
			selection[test.key] = test.value
			if comicStyleSelection(selection) != nil {
				t.Fatalf("malformed %s accepted: %#v", test.key, test.value)
			}
		})
	}
}

func TestComicStyleSelectionParticipatesInNativeResourceCollection(t *testing.T) {
	selection := map[string]any{"id": "style", "title": "Uploaded style", "coverUrl": "/api/resources/style-cover/file", "referenceResourceId": "style-reference"}
	node := map[string]any{"id": "source", "type": "text", "metadata": map[string]any{"comic": map[string]any{
		"version": 1, "role": "source", "settings": map[string]any{"styleSelection": selection},
	}}}
	encoded, _ := json.Marshal(map[string]any{"nodes": []any{node}})
	refs, err := assets.CollectDocumentResourceReferences(string(encoded))
	if err != nil || len(refs) != 2 {
		t.Fatalf("style resource locators escaped collection: %#v, %v", refs, err)
	}
	for _, ref := range refs {
		if ref.NodeID != "source" || !strings.HasPrefix(ref.Path, "nodes[source].metadata.comic.settings.styleSelection.") {
			t.Fatalf("style resource lost source-node ownership context: %#v", ref)
		}
		if (ref.ReferenceType == "coverUrl" && ref.ResourceID != "style-cover") || (ref.ReferenceType == "referenceResourceId" && ref.ResourceID != "style-reference") {
			t.Fatalf("incorrect style resource locator: %#v", ref)
		}
	}
	selection["coverUrl"] = "/comic-style-previews/ink.webp"
	delete(selection, "referenceResourceId")
	encoded, _ = json.Marshal(map[string]any{"nodes": []any{node}})
	refs, err = assets.CollectDocumentResourceReferences(string(encoded))
	if err != nil || len(refs) != 0 {
		t.Fatalf("bundled style preview was mistaken for a private resource: %#v, %v", refs, err)
	}
}

func TestComicCreationChoicesAcceptOnlySupportedEnumsAndAutoPanelCount(t *testing.T) {
	options := map[string][]string{
		"storyType":       {"auto", "original", "campus", "workplace", "reunion", "secret", "misunderstanding", "destiny", "forbidden", "regret", "mystery", "fantasy", "urban", "history", "scifi", "horror", "wuxia", "adventure"},
		"emotionTone":     {"auto", "original", "sweet", "angst", "funny", "forbidden", "suspense", "epic", "horror", "warm"},
		"narrativePreset": {"audio_comic_drama", "single_dialogue_v3_webtoon", "cinematic_single_panel", "relationship_single_panel", "suspense_single_panel", "action_single_panel", "pov_suspense_single_panel"},
	}
	for key, values := range options {
		for _, value := range values {
			node := map[string]any{"type": "text", "metadata": map[string]any{"comic": map[string]any{
				"version": 1, "role": "source", "settings": map[string]any{key: value, "panelCount": "auto"},
			}}}
			for _, project := range []func(map[string]any) map[string]any{ComicNodeMetadata, ComicNodeProjection} {
				settings := project(node)["settings"].(map[string]any)
				if settings[key] != value || settings["panelCount"] != "auto" {
					t.Fatalf("valid %s or auto count lost: %#v", key, settings)
				}
			}
		}
		for _, value := range []any{"", "unknown", " auto", "AUTO", "auto,original", "multi_panel_layout", "interactive", 1, true, map[string]any{"private": "PRIVATE_SENTINEL"}} {
			node := map[string]any{"type": "text", "metadata": map[string]any{"comic": map[string]any{
				"version": 1, "role": "source", "settings": map[string]any{key: value, "panelCount": 24},
			}}}
			settings := ComicNodeProjection(node)["settings"].(map[string]any)
			if _, exists := settings[key]; exists || settings["panelCount"] != 24 {
				t.Fatalf("unsupported %s leaked or fixed count changed: %#v", key, settings)
			}
		}
	}
}
