# 任务执行备忘：电商图工作室插件安装与上游费用 2 倍积分抵扣改造

## 任务背景与目标

本任务由用户明确提出，包含两个核心子任务：
1. **安装用户自制的电商图工作室插件**：
   - 源码包位置：`用户提供的 ecommerce-image-studio-source.zip`
   - 解压及编译目录：`仓库目录/plugin-packages/ecommerce-image-studio`
   - 构建生成的目标插件包：`仓库目录/plugin-packages/ecommerce-image-studio.yingce-plugin`
   - 目标：将该插件部署至后端容器 `/app/plugin-packages/` 并热加载，使管理端 `/admin/plugins` 与系统渠道可正常选用该插件协议进行商品图生成。

2. **读取上游渠道模型调用费用，按 2 倍抵扣积分（严格区分按次与按秒）**：
   - **计费模式区分**：
     - `fixed_request`（按次计费）：如生图（含电商图插件）、固定规格视频，按单次调用进价 $\times 2.0$ 抵扣积分。
     - `per_second`（按秒计费）：如常规视频、音频生成，按实际生成时长秒数（`video_seconds` / `duration`）$\times$ 每秒进价 $\times 2.0$ 抵扣积分。
   - **上游成本来源与改造方案**：
     - 来源1（动态成本）：上游网关（如 MoAI / NewAPI）在查询终态返回 `cost`（元/美元），在后端结算钩子中提取并乘以 2 倍换算积分。
     - 来源2（配置进价）：基于系统 `model_pricings` 表的 `per_request_micros` 与 `per_video_second_micros`，将倍率设置为 20,000 基点（2.0 倍）。

## 当前状态与进度
- [x] 插件包已校验，符合 `yingce.plugin/v2` 规范。
- [x] 插件已解压至 `plugin-packages/ecommerce-image-studio` 并成功打包为 `.yingce-plugin`。
- [ ] 插件复制到部署容器 `/app/plugin-packages/` 并重启或加载生效。
- [x] 检查并实现 2 倍上游费用积分抵扣模块。
- [x] 生图价格按渠道实价校准并生效：
  - 爱拍：进价 0.06 元，2倍扣 0.12 积分。
  - LensAPI：进价 0.01 元，2倍扣 0.02 积分（含电商图插件）。
  - OpenAI 官方：最终扣除 0.5 积分（基准进价 0.25 元）。
  - MoAI 单独生图专线（CHANNEL_000008）：引入 gpt-image 系列 4 个模型，进价 0.01 元，2倍扣 0.02 积分。
