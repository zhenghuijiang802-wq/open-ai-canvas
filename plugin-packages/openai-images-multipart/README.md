# OpenAI Images（文件上传）

独立协议 ID：`openai-image-multipart`。用于图生图要求 multipart 文件上传的渠道。与已有 `openai-image` JSON 协议并存，按渠道文档选择。

## 请求合同

- 无参考图：POST `/v1/images/generations`，application/json。
- 有参考图：POST `/v1/images/edits`，multipart/form-data；宿主生成 boundary，不手写 Content-Type。
- 非 mask 参考图按 order 排序，逐张写入 `image[]` 文件字段，保留文件名、MIME 和图片字节；可处理已解析的本地资源、data URL 或受出站安全规则约束的 URL。
- mask 角色独立写入 `mask` 文件字段。渠道不支持 mask 时必须在模型能力配置中禁用；爱拍模型已禁用。
- model、prompt、n、size、quality 等为普通字段。参考图不写入 JSON images/image_url。
- 返回 data[].url 或 data[].b64_json，交给宿主持久化。默认 responseFormat=url。
- providerOptions 使用 openai-image-multipart 命名空间。

## 接入和验证

在插件中心导入相邻的 `.yingce-plugin` 包，在渠道模型中选择“OpenAI Images（文件上传）”。尺寸、数量和参考图限制按供应商文档收窄。爱拍同步接口 n=1、最多 10 张参考图、不支持 mask；这不是所有兼容渠道的通用限制。

本插件不包含密钥，不改变原有 JSON 插件，不提供失败后自动换协议重试。更新已安装插件或切换模型前保留原配置以便回滚。
