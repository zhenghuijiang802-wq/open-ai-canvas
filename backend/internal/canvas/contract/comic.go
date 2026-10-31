package contract

import (
	"encoding/json"
	"strings"
	"unicode"
	"unicode/utf8"

	"yingce/backend/internal/assets"
)

// ComicNodeMetadata copies only semantic comic fields, excluding task state.
// It does not grant the Agent permission to write extension metadata or treat
// it as instructions.
func ComicNodeMetadata(node map[string]any) map[string]any {
	metadata, _ := node["metadata"].(map[string]any)
	comic, _ := metadata["comic"].(map[string]any)
	if _, ok := comicInteger(comic["version"], 1, 1); !ok {
		return nil
	}
	role, _ := comic["role"].(string)
	if (role == "source" && node["type"] != "text") ||
		((role == "asset" || role == "panel") && node["type"] != "image") {
		return nil
	}
	result := map[string]any{"version": 1, "role": role}
	switch role {
	case "source":
		settings, _ := comic["settings"].(map[string]any)
		clean := map[string]any{}
		for _, key := range []string{"style", "aspectRatio"} {
			if value, ok := settings[key].(string); ok {
				clean[key] = value
			}
		}
		if settings["panelCount"] == "auto" {
			clean["panelCount"] = "auto"
		} else if count, ok := comicInteger(settings["panelCount"], 1, 24); ok {
			clean["panelCount"] = count
		}
		for key, options := range map[string][]string{
			"storyType":       {"auto", "original", "campus", "workplace", "reunion", "secret", "misunderstanding", "destiny", "forbidden", "regret", "mystery", "fantasy", "urban", "history", "scifi", "horror", "wuxia", "adventure"},
			"emotionTone":     {"auto", "original", "sweet", "angst", "funny", "forbidden", "suspense", "epic", "horror", "warm"},
			"narrativePreset": {"audio_comic_drama", "single_dialogue_v3_webtoon", "cinematic_single_panel", "relationship_single_panel", "suspense_single_panel", "action_single_panel", "pov_suspense_single_panel"},
		} {
			if value, ok := settings[key].(string); ok {
				for _, option := range options {
					if value == option {
						clean[key] = value
						break
					}
				}
			}
		}
		if defaults := comicImageDefaults(settings["imageDefaults"]); defaults != nil {
			clean["imageDefaults"] = defaults
		}
		if selection := comicStyleSelection(settings["styleSelection"]); selection != nil {
			clean["styleSelection"] = selection
		}
		result["settings"] = clean
	case "asset", "panel":
		if enabled, ok := comic["useUnifiedStyle"].(bool); ok {
			result["useUnifiedStyle"] = enabled
		}
		if prefix, ok := comic["promptStylePrefix"].(string); ok && utf8.ValidString(prefix) && utf8.RuneCountInString(prefix) <= 1000 {
			result["promptStylePrefix"] = prefix
		}
		if order, ok := comicInteger(comic["order"], 0, 10000); ok {
			result["order"] = order
		}
		if role == "asset" {
			kind, _ := comic["assetKind"].(string)
			if kind == "character" || kind == "scene" || kind == "prop" {
				result["assetKind"] = kind
			}
		} else {
			if excerpt, ok := comic["sourceExcerpt"].(string); ok {
				result["sourceExcerpt"] = excerpt
			}
			var values []any
			switch ids := comic["assetNodeIds"].(type) {
			case []any:
				values = ids
			case []string:
				values = make([]any, 0, len(ids))
				for _, id := range ids {
					values = append(values, id)
				}
			}
			if values != nil {
				ids := make([]string, 0, len(values))
				seen := map[string]bool{}
				for _, value := range values {
					id, ok := value.(string)
					if ok && comicNodeID(id) && !seen[id] {
						ids = append(ids, id)
						seen[id] = true
					}
				}
				result["assetNodeIds"] = ids
			}
		}
	default:
		return nil
	}
	return result
}

func comicStyleSelection(value any) map[string]any {
	selection, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	clean := map[string]any{}
	for _, key := range []string{"id", "title"} {
		text, ok := selection[key].(string)
		if !ok || strings.TrimSpace(text) == "" || !utf8.ValidString(text) || utf8.RuneCountInString(text) > 200 || strings.IndexFunc(text, unicode.IsControl) >= 0 {
			return nil
		}
		clean[key] = text
	}
	if value, exists := selection["coverUrl"]; exists {
		cover, ok := value.(string)
		if !ok || !comicStyleCoverURL(cover) {
			return nil
		}
		clean["coverUrl"] = cover
	}
	if value, exists := selection["referenceResourceId"]; exists {
		id, ok := value.(string)
		// Match the resource collector's exact ID contract so every persisted
		// style reference participates in ownership and deletion checks.
		if !ok || id == "" || assets.ValidID(id) != id {
			return nil
		}
		clean["referenceResourceId"] = id
	}
	return clean
}

func comicStyleCoverURL(value string) bool {
	const resourcePrefix = "/api/resources/"
	if strings.HasPrefix(value, resourcePrefix) && strings.HasSuffix(value, "/file") {
		id := strings.TrimSuffix(strings.TrimPrefix(value, resourcePrefix), "/file")
		return id != "" && assets.ValidID(id) == id
	}
	const previewPrefix = "/comic-style-previews/"
	if strings.HasPrefix(value, previewPrefix) && strings.HasSuffix(value, ".webp") {
		name := strings.TrimSuffix(strings.TrimPrefix(value, previewPrefix), ".webp")
		return name != "" && assets.ValidID(name) == name
	}
	return false
}

// This is a public image selection, never a provider configuration. Unsupported
// keys and malformed values are omitted rather than forwarded to the Agent.
func comicImageDefaults(value any) map[string]any {
	defaults, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	clean := map[string]any{}
	for key, limit := range map[string]int{
		"model": 512, "size": 64, "quality": 64, "imageResolution": 64,
		"transparentBackground": 5, "count": 2, "imageParameters": 32768,
	} {
		text, ok := defaults[key].(string)
		if !ok || !utf8.ValidString(text) || utf8.RuneCountInString(text) > limit {
			continue
		}
		if key == "transparentBackground" && text != "true" && text != "false" {
			continue
		}
		if key == "count" && text != "1" {
			continue
		}
		if key == "imageParameters" {
			var parameters map[string]any
			if err := json.Unmarshal([]byte(text), &parameters); err != nil || parameters == nil {
				continue
			}
			valid := true
			for _, parameter := range parameters {
				switch parameter.(type) {
				case string, bool, float64:
				default:
					valid = false
				}
			}
			if !valid {
				continue
			}
		}
		clean[key] = text
	}
	return clean
}

func comicNodeID(id string) bool {
	if id == "" || strings.TrimSpace(id) != id || !utf8.ValidString(id) || utf8.RuneCountInString(id) > 160 {
		return false
	}
	for _, r := range id {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// ComicNodeProjection bounds model-visible text and references. The full
// controlled fields remain intact when an existing media draft is submitted.
func ComicNodeProjection(node map[string]any) map[string]any {
	comic := ComicNodeMetadata(node)
	if comic == nil {
		return nil
	}
	if settings, ok := comic["settings"].(map[string]any); ok {
		comicBoundText(settings, "style", 1000)
		comicBoundText(settings, "aspectRatio", 32)
	}
	comicBoundText(comic, "sourceExcerpt", 4000)
	if ids, ok := comic["assetNodeIds"].([]string); ok && len(ids) > 30 {
		comic["assetNodeIds"] = ids[:30]
		comic["assetNodeIdsTruncated"] = true
	}
	return comic
}

func comicBoundText(fields map[string]any, key string, limit int) {
	if text, ok := fields[key].(string); ok {
		runes := []rune(text)
		if len(runes) > limit {
			fields[key] = string(runes[:limit])
			fields[key+"Truncated"] = true
		}
	}
}

func comicInteger(value any, minimum, maximum int) (int, bool) {
	switch number := value.(type) {
	case int:
		return number, number >= minimum && number <= maximum
	case float64:
		if number >= float64(minimum) && number <= float64(maximum) && number == float64(int(number)) {
			return int(number), true
		}
	}
	return 0, false
}
