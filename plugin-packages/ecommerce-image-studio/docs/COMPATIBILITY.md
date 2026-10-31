# 兼容说明

目标：支持 `yingce.plugin/v2`、声明式 Provider、多媒体参考图和 `imageParameters` 的影策版本。

运行方式：宿主解析JSON表达式，将商品参考图和插件构建的提示词发送至渠道配置的图片编辑接口；权限只有 `generation.run` 和 `media.read`。

请求合同：POST /v1/images/edits，application/json，Bearer鉴权，model/prompt/images/n/size/quality/output_format。只支持官方插件采用的JSON图片引用形式；不承诺兼容所有号称OpenAI兼容的服务。

源码依据：官方 `backend/internal/protocol/{types,manifest,package,image_parameters,expression}.go` 与 `plugin-packages/openai-images/manifest.json`。

安装包与请求测试不使用真实密钥，不发送付费生图请求。宿主UI安装与真实出图需要在用户实例配置模型后验证。

## 验证记录

2026-10-30：使用上游提交 `f83c35b0e8c203a4031f82b00e5652d02c8bd06b` 的原始 protocol 包，在隔离的 Go 1.25.3 测试模块中验证，未修改宿主实现。

- 实际 `ParsePluginPackage` / `LoadInstalledProviders` 成功读取安装包。
- 实际 `BuildCreate` 验证默认参数、6种图型、品牌约束、文案、尺寸、候选数量和参考图URL传递。
- 缺失/过量参考图、遮罩图、非法图型/尺寸/数量均被拒绝。
- 图片URL与Base64响应解析成功；上游错误未被包装为成功。
- 白底主图禁用新增文案，避免与白底模板产生冲突。

以上4个测试组（含12个子测试）通过。未验证完整影策前端安装流程、渠道配置持久化或真实付费图片生成效果。

复现：安装 Go 1.25+ 和 Python，检出上述上游提交，然后运行 `python tests/verify.py --upstream <影策源码目录>`。测试程序只复制协议源文件到临时目录，不修改上游检出。
