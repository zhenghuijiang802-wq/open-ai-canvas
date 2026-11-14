package protocol

import (
 "fmt"
 "context"
 "os"
 "strings"
 "testing"
)

func ecommerceAdapter(t *testing.T) Adapter {
 t.Helper()
 raw, err := os.ReadFile(os.Getenv("ECOMMERCE_PACKAGE")); if err != nil { t.Fatal(err) }
 pkg, err := ParsePluginPackage(raw); if err != nil { t.Fatal(err) }
 if len(pkg.Manifest.Contributes.Providers) != 1 { t.Fatal("expected one provider") }
 adapters, err := LoadInstalledProviders(pkg.ManifestRaw, nil); if err != nil { t.Fatal(err) }
 return adapters[0]
}
func productRequest() GenerationRequest {
 return GenerationRequest{Capability:CapabilityImage, Model:"configured-image-model", Prompt:"红色杯子，保持原包装", Images:[]MediaReference{{URL:"https://example.com/product.png",Kind:"image",Order:0}}}
}
func TestEcommercePackageAndDefaultRequest(t *testing.T) {
 a:=ecommerceAdapter(t)
 spec,err:=a.BuildCreate(context.Background(),RequestContext{Request:productRequest()}); if err!=nil {t.Fatal(err)}
 if spec.Path!="/v1/images/edits" || spec.Method!="POST" || spec.ContentType!="application/json" {t.Fatalf("bad endpoint: %+v",spec)}
 b:=spec.Body.(map[string]any)
 if b["model"]!="configured-image-model" || b["size"]!="1024x1024" || b["quality"]!="medium" {t.Fatalf("incorrect defaults: %+v",b)}
 if len(b["images"].([]any))!=1 {t.Fatal("reference lost")}
 if b["images"].([]any)[0].(map[string]any)["image_url"]!="https://example.com/product.png" {t.Fatal("reference URL changed")}
 p:=b["prompt"].(string)
 for _,s:=range []string{"#FFFFFF","白底商品主图","红色杯子","不新增任何文字"} {if !strings.Contains(p,s) {t.Fatalf("missing %s",s)}}
 if spec.Auth.Type!="bearer" || spec.Auth.Field!="apiKey" {t.Fatal("wrong credential binding")}
}
func TestEcommerceScenesAndCustomParameters(t *testing.T) {
 a:=ecommerceAdapter(t)
 scenes:=map[string]string{"白底主图":"白底商品主图","使用场景图":"真实使用场景图","核心卖点图":"单一核心卖点图","材质细节图":"材质与工艺细节特写","SKU规格图":"SKU规格展示图","活动横幅图":"横幅广告构图"}
 for scene,want:=range scenes {t.Run(scene,func(t *testing.T){
  r:=productRequest(); r.ImageParameters=map[string]any{"scene":scene,"style":"温暖生活","textMode":"使用指定文案","copy":"轻装出发","brand":"#112233","size":"1536x1024","count":float64(2)}
  spec,err:=a.BuildCreate(context.Background(),RequestContext{Request:r}); if err!=nil {t.Fatal(err)}
  b:=spec.Body.(map[string]any); p:=b["prompt"].(string)
  for _,s:=range []string{want,"自然窗光","#112233"} {if !strings.Contains(p,s) {t.Fatalf("missing %s",s)}}
  if scene=="白底主图" {if strings.Contains(p,"轻装出发") {t.Fatal("white hero must ignore new copy")}} else if !strings.Contains(p,"轻装出发") {t.Fatal("copy lost")}
  if b["size"]!="1536x1024" || fmt.Sprint(b["n"])!="2" {t.Fatalf("parameter binding failed: %+v",b)}
 })}
}
func TestEcommerceRejectsInvalidInputs(t *testing.T) {
 a:=ecommerceAdapter(t)
 cases:=[]struct{name string; mutate func(*GenerationRequest)}{
  {"no reference",func(r *GenerationRequest){r.Images=nil}},
  {"too many references",func(r *GenerationRequest){for len(r.Images)<7 {r.Images=append(r.Images,r.Images[0])}}},
  {"mask",func(r *GenerationRequest){r.Images[0].Role="mask"}},
  {"invalid scene",func(r *GenerationRequest){r.ImageParameters=map[string]any{"scene":"unknown"}}},
  {"too many candidates",func(r *GenerationRequest){r.ImageParameters=map[string]any{"count":float64(5)}}},
  {"invalid size",func(r *GenerationRequest){r.ImageParameters=map[string]any{"size":"1x1"}}},
 }
 for _,c:=range cases {t.Run(c.name,func(t *testing.T){r:=productRequest(); c.mutate(&r); if _,err:=a.BuildCreate(context.Background(),RequestContext{Request:r}); err==nil {t.Fatal("invalid request accepted")}})}
}
func TestEcommerceResponses(t *testing.T) {
 a:=ecommerceAdapter(t)
 for _,body:=range []string{`{"data":[{"url":"https://example.com/result.png"}]}`,`{"data":[{"b64_json":"aGVsbG8="}]}`} {
  result,err:=a.ParseCreate(context.Background(),[]byte(body)); if err!=nil {t.Fatal(err)}
  if result.Status!=StatusSucceeded || result.Result==nil || len(result.Result.Images)!=1 {t.Fatalf("result missing: %+v",result)}
 }
 result,err:=a.ParseCreate(context.Background(),[]byte(`{"error":{"code":"invalid_api_key","message":"bad key"}}`))
 if err==nil && result.Status==StatusSucceeded {t.Fatal("provider error reported as success")}
}
