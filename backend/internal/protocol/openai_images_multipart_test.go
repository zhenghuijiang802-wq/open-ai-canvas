package protocol

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func multipartPackageAdapter(t *testing.T, name, provider string) Adapter {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", name+".yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(b)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range adapters {
		if a.Metadata().ID == provider {
			return a
		}
	}
	t.Fatalf("missing provider %s", provider)
	return nil
}

func TestOpenAIImagesMultipartContract(t *testing.T) {
	a := multipartPackageAdapter(t, "openai-images-multipart", "openai-image-multipart")
	for _, count := range []int{0, 1, 2} {
		r := GenerationRequest{Model: "gpt-image-2", Prompt: "Change the square to green", AspectRatio: "1024x1024", ImageCount: 1}
		if count > 0 {
			r.Images = append(r.Images, MediaReference{DataURL: "data:image/png;base64,QUJD", Name: "first.png", MIMEType: "image/png", Role: "reference", Order: 1})
		}
		if count > 1 {
			r.Images = append([]MediaReference{{URL: "https://example.com/second.jpg", Name: "second.jpg", MIMEType: "image/jpeg", Role: "reference", Order: 2}}, r.Images...)
		}
		spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
		if err != nil {
			t.Fatal(err)
		}
		path, content := "/v1/images/generations", "application/json"
		if count > 0 {
			path, content = "/v1/images/edits", "multipart/form-data"
		}
		if spec.Path != path || spec.ContentType != content || spec.Method != "POST" {
			t.Fatalf("count %d: wrong request %#v", count, spec)
		}
		if len(spec.Files) != count {
			t.Fatalf("count %d: files=%#v", count, spec.Files)
		}
		var body map[string]any
		data, _ := json.Marshal(spec.Body)
		if err := json.Unmarshal(data, &body); err != nil {
			t.Fatal(err)
		}
		for _, field := range []string{"images", "image", "mask"} {
			if _, ok := body[field]; ok {
				t.Fatalf("unexpected JSON image field %s", field)
			}
		}
		if body["model"] != r.Model || body["prompt"] != r.Prompt || body["size"] != r.AspectRatio || body["n"] != float64(1) || body["response_format"] != "url" {
			t.Fatalf("fields=%#v", body)
		}
		if count > 0 && (spec.Files[0].Name != "image[]" || spec.Files[0].Reference.DataURL != "data:image/png;base64,QUJD" || spec.Files[0].Filename != "first.png" || spec.Files[0].MIMEType != "image/png") {
			t.Fatalf("first file=%#v", spec.Files[0])
		}
		if count > 1 && (spec.Files[1].Name != "image[]" || spec.Files[1].Reference.URL != "https://example.com/second.jpg" || spec.Files[1].Filename != "second.jpg") {
			t.Fatalf("second file=%#v", spec.Files[1])
		}
	}
}

func TestOpenAIImagesMultipartSeparatesMask(t *testing.T) {
	a := multipartPackageAdapter(t, "openai-images-multipart", "openai-image-multipart")
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "gpt-image-2", Prompt: "edit", Images: []MediaReference{
		{DataURL: "data:image/png;base64,QUJD", Role: "reference", Name: "image.png"},
		{DataURL: "data:image/png;base64,REVG", Role: "mask", Name: "mask.png"},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(spec.Files) != 2 || spec.Files[0].Name != "image[]" || spec.Files[1].Name != "mask" || spec.Files[1].Reference.DataURL != "data:image/png;base64,REVG" {
		t.Fatalf("files=%#v", spec.Files)
	}
}

func TestOpenAIImagesLegacyJSONStillWorks(t *testing.T) {
	a := multipartPackageAdapter(t, "openai-images", "openai-image")
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "gpt-image-2", Prompt: "edit", Images: []MediaReference{{DataURL: "data:image/png;base64,QUJD"}}}})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Path != "/v1/images/edits" || spec.ContentType != "application/json" || len(spec.Files) != 0 {
		t.Fatalf("legacy request changed: %#v", spec)
	}
}
