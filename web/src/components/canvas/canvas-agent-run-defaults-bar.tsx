import { useMemo, useState } from "react";
import { Input, Popover, Segmented } from "antd";
import { Layers, RotateCcw, SlidersHorizontal, StepForward } from "lucide-react";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { VideoSettingsPanel } from "@/components/video-settings-panel";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { agentApprovalModel, agentApprovalModelSelection } from "@/lib/canvas/agent-media-approval";
import { compactAgentMediaDefaults } from "@/lib/canvas/agent-run-defaults";
import { parseImageParameters } from "@/lib/image-parameters";
import { modelCapabilityConfigFor, normalizeImageValue, normalizeVideoValue } from "@/lib/model-capabilities";
import type { AgentMediaDefaults, AgentMediaExecutionMode, AgentMediaSettings, AgentPermissionMode } from "@/services/api/agent";
import { PUBLIC_MODEL_CATALOG_ID, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

function sanitizedImageParameters(value?: string) {
    if (value === undefined) return undefined;
    return JSON.stringify(Object.fromEntries(Object.entries(parseImageParameters(value)).filter(([key]) => !["size", "imageResolution", "quality"].includes(key))));
}

function modelLabel(config: AiConfig, modelValue: string) {
    if (!modelValue) return "";
    const [, name] = modelValue.split("::");
    return name || modelValue;
}

export function CanvasAgentRunDefaultsBar({
    theme,
    config,
    permissionMode,
    mediaExecutionMode,
    maxCredits,
    maxGenerationTasks,
    maxVideoSeconds,
    mediaDefaults,
    disabled,
    onPermissionModeChange,
    onMediaExecutionModeChange,
    onMaxCreditsChange,
    onMaxGenerationTasksChange,
    onMaxVideoSecondsChange,
    onMediaDefaultsChange,
}: {
    theme: CanvasTheme;
    config: AiConfig;
    permissionMode: AgentPermissionMode;
    mediaExecutionMode: AgentMediaExecutionMode;
    maxCredits: string;
    maxGenerationTasks: string;
    maxVideoSeconds: string;
    mediaDefaults: AgentMediaDefaults;
    disabled?: boolean;
    onPermissionModeChange: (mode: AgentPermissionMode) => void;
    onMediaExecutionModeChange: (mode: AgentMediaExecutionMode) => void;
    onMaxCreditsChange: (value: string) => void;
    onMaxGenerationTasksChange: (value: string) => void;
    onMaxVideoSecondsChange: (value: string) => void;
    onMediaDefaultsChange: (next: AgentMediaDefaults) => void;
}) {
    const [open, setOpen] = useState(false);
    const [mediaTab, setMediaTab] = useState<"image" | "video">("image");

    const catalogConfig = useMemo(
        () => ({
            ...config,
            channels: config.channels.filter((channel) => channel.scope === "system" || channel.id === PUBLIC_MODEL_CATALOG_ID),
        }),
        [config],
    );

    const imageSettings: AgentMediaSettings = useMemo(() => mediaDefaults.image || { size: "", quality: "" }, [mediaDefaults.image]);
    const videoSettings: AgentMediaSettings = useMemo(() => mediaDefaults.video || { size: "", quality: "" }, [mediaDefaults.video]);
    const imageModel = useMemo(() => (mediaDefaults.image ? agentApprovalModel(catalogConfig, imageSettings, "image") : ""), [catalogConfig, imageSettings, mediaDefaults.image]);
    const videoModel = useMemo(() => (mediaDefaults.video ? agentApprovalModel(catalogConfig, videoSettings, "video") : ""), [catalogConfig, videoSettings, mediaDefaults.video]);

    const updateImageDefaults = (next?: AgentMediaSettings) => {
        onMediaDefaultsChange(compactAgentMediaDefaults({ ...mediaDefaults, image: next }) || {});
    };

    const updateVideoDefaults = (next?: AgentMediaSettings) => {
        onMediaDefaultsChange(compactAgentMediaDefaults({ ...mediaDefaults, video: next }) || {});
    };

    const handleImageModelChange = (nextModel: string) => {
        if (disabled) return;
        if (!nextModel) {
            updateImageDefaults(undefined);
            return;
        }
        const profile = modelCapabilityConfigFor(catalogConfig, nextModel).image;
        if (!profile) return;
        const normalized = normalizeImageValue(profile, imageSettings, resolveModelRequestConfig(catalogConfig, nextModel).interfaceType);
        updateImageDefaults({
            ...agentApprovalModelSelection(catalogConfig, nextModel),
            size: normalized.size,
            imageResolution: normalized.imageResolution,
            imageParameters: sanitizedImageParameters(normalized.imageParameters),
            quality: profile.quality.supported ? normalized.quality : "",
        });
    };

    const handleImageOptionChange = (key: "quality" | "imageResolution" | "imageParameters" | "size" | "transparentBackground" | "count", next: string) => {
        if (disabled || (key !== "size" && key !== "quality" && key !== "imageResolution" && key !== "imageParameters")) return;
        if (key === "imageParameters") {
            updateImageDefaults({ ...imageSettings, imageParameters: sanitizedImageParameters(next) });
            return;
        }
        updateImageDefaults({
            ...imageSettings,
            ...(imageModel ? agentApprovalModelSelection(catalogConfig, imageModel) : {}),
            [key]: next,
        });
    };

    const handleVideoModelChange = (nextModel: string) => {
        if (disabled) return;
        if (!nextModel) {
            updateVideoDefaults(undefined);
            return;
        }
        const profile = modelCapabilityConfigFor(catalogConfig, nextModel).video;
        if (!profile) return;
        const normalized = normalizeVideoValue(profile, {
            seconds: videoSettings.durationSeconds ? String(videoSettings.durationSeconds) : "",
            ratio: videoSettings.size,
            resolution: videoSettings.quality,
        });
        updateVideoDefaults({
            ...agentApprovalModelSelection(catalogConfig, nextModel),
            size: normalized.ratio,
            quality: normalized.resolution,
            durationSeconds: normalized.seconds ? Number(normalized.seconds) : videoSettings.durationSeconds,
            videoGenerateAudio: videoSettings.videoGenerateAudio,
            videoWatermark: videoSettings.videoWatermark,
            videoArkPrivateAssetUpload: videoSettings.videoArkPrivateAssetUpload,
        });
    };

    const handleVideoOptionChange = (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoArkPrivateAssetUpload", next: string) => {
        if (disabled) return;
        updateVideoDefaults({
            ...videoSettings,
            ...(videoModel ? agentApprovalModelSelection(catalogConfig, videoModel) : {}),
            size: key === "size" ? next : videoSettings.size,
            quality: key === "vquality" ? next : videoSettings.quality,
            durationSeconds: key === "videoSeconds" ? (Number(next) > 0 ? Number(next) : undefined) : videoSettings.durationSeconds,
            videoGenerateAudio: key === "videoGenerateAudio" ? next === "true" : videoSettings.videoGenerateAudio,
            videoWatermark: key === "videoWatermark" ? next === "true" : videoSettings.videoWatermark,
            videoArkPrivateAssetUpload: key === "videoArkPrivateAssetUpload" ? next === "true" : videoSettings.videoArkPrivateAssetUpload,
        });
    };

    const summaryParts = [
        `积分≤${maxCredits || "200"}`,
        Number(maxGenerationTasks) > 0 ? `生成≤${maxGenerationTasks}` : null,
        imageModel ? `图:${modelLabel(catalogConfig, imageModel)}` : null,
        videoModel ? `视频:${modelLabel(catalogConfig, videoModel)}` : null,
    ].filter(Boolean);

    const popoverContent = (
        <div className="thin-scrollbar max-h-[min(68vh,460px)] w-[min(352px,calc(100vw-32px))] space-y-4 overflow-y-auto p-1" data-canvas-no-zoom data-canvas-wheel-scroll>
            <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold" style={{ color: theme.node.text }}>
                    <span>执行权限</span>
                    <span className="text-[var(--fs-label)] font-normal" style={{ color: theme.node.muted }}>
                        {permissionMode === "auto" ? "自动执行" : permissionMode === "request_approval" ? "逐项审批" : "仅只读分析"}
                    </span>
                </div>
                <Segmented
                    block
                    size="small"
                    disabled={disabled}
                    value={permissionMode}
                    onChange={(value) => onPermissionModeChange(value as AgentPermissionMode)}
                    options={[
                        { label: "自动执行", value: "auto" },
                        { label: "逐项审批", value: "request_approval" },
                        { label: "只读", value: "read_only" },
                    ]}
                />
            </div>

            <div className="space-y-2">
                <div className="text-xs font-semibold" style={{ color: theme.node.text }}>
                    本轮预算上限
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <label className="block text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                        <span>积分上限</span>
                        <Input size="small" className="mt-1" inputMode="numeric" disabled={disabled} value={maxCredits} onChange={(event) => onMaxCreditsChange(event.target.value.replace(/[^0-9]/g, ""))} />
                    </label>
                    <label className="block text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                        <span>生成任务数 (0不限)</span>
                        <Input
                            size="small"
                            className="mt-1"
                            inputMode="numeric"
                            disabled={disabled || permissionMode === "read_only"}
                            value={maxGenerationTasks}
                            onChange={(event) => onMaxGenerationTasksChange(event.target.value.replace(/[^0-9]/g, ""))}
                        />
                    </label>
                    <label className="block text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                        <span>视频秒数 (0不限)</span>
                        <Input size="small" className="mt-1" inputMode="numeric" disabled={disabled || permissionMode === "read_only"} value={maxVideoSeconds} onChange={(event) => onMaxVideoSecondsChange(event.target.value.replace(/[^0-9]/g, ""))} />
                    </label>
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold" style={{ color: theme.node.text }}>
                        默认生成模型与规格
                    </span>
                    {(mediaDefaults.image || mediaDefaults.video) && !disabled ? (
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[var(--fs-label)] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/25"
                            style={{ color: theme.node.muted }}
                            onClick={() => onMediaDefaultsChange({})}
                        >
                            <RotateCcw className="size-3" aria-hidden="true" />
                            <span>清空默认</span>
                        </button>
                    ) : null}
                </div>
                <p className="text-[var(--fs-label)] leading-4" style={{ color: theme.node.muted }}>
                    自动执行且工具未另行指定参数时，直接套用这里确认好的模型与画幅规格，不再反复确认。
                </p>
                <Segmented
                    block
                    size="small"
                    value={mediaTab}
                    onChange={(value) => setMediaTab(value as "image" | "video")}
                    options={[
                        { label: imageModel ? "图片参数 (已设)" : "图片参数", value: "image" },
                        { label: videoModel ? "视频参数 (已设)" : "视频参数", value: "video" },
                    ]}
                />
                {mediaTab === "image" ? (
                    <div className="space-y-2.5 pt-1">
                        <ModelPicker
                            config={catalogConfig}
                            capability="image"
                            value={imageModel}
                            onChange={handleImageModelChange}
                            variant="creation"
                            fullWidth
                            showOptionPrices
                            placeholder="选择默认生图模型"
                            popoverClassName="agent-model-picker-popover"
                        />
                        {imageModel ? (
                            <ImageSettingsPanel
                                config={{
                                    ...catalogConfig,
                                    model: imageModel,
                                    imageModel,
                                    size: imageSettings.size,
                                    imageResolution: imageSettings.imageResolution || "auto",
                                    imageParameters: imageSettings.imageParameters,
                                    quality: imageSettings.quality,
                                    count: "1",
                                }}
                                onConfigChange={handleImageOptionChange}
                                theme={theme}
                                showTitle={false}
                                showCount={false}
                                showTransparent={false}
                                className="min-w-0 space-y-2.5"
                            />
                        ) : null}
                    </div>
                ) : (
                    <div className="space-y-2.5 pt-1">
                        <ModelPicker
                            config={catalogConfig}
                            capability="video"
                            value={videoModel}
                            onChange={handleVideoModelChange}
                            variant="creation"
                            fullWidth
                            showOptionPrices
                            placeholder="选择默认生视频模型"
                            popoverClassName="agent-model-picker-popover"
                        />
                        {videoModel ? (
                            <VideoSettingsPanel
                                config={{
                                    ...catalogConfig,
                                    model: videoModel,
                                    size: videoSettings.size,
                                    videoSeconds: videoSettings.durationSeconds ? String(videoSettings.durationSeconds) : "",
                                    vquality: videoSettings.quality,
                                    videoGenerateAudio: videoSettings.videoGenerateAudio === undefined ? "" : String(videoSettings.videoGenerateAudio),
                                    videoWatermark: videoSettings.videoWatermark === undefined ? "" : String(videoSettings.videoWatermark),
                                    videoArkPrivateAssetUpload: videoSettings.videoArkPrivateAssetUpload === undefined ? "" : String(videoSettings.videoArkPrivateAssetUpload),
                                }}
                                onConfigChange={handleVideoOptionChange}
                                theme={theme}
                                showTitle={false}
                                className="min-w-0 space-y-2.5"
                            />
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-2" data-canvas-no-zoom aria-label="运行默认参数与生成调度策略">
            <div className="inline-flex items-center rounded-lg p-0.5" style={{ background: theme.node.fill }} role="group" aria-label="生成调度方式">
                <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={mediaExecutionMode === "sequential"}
                    onClick={() => onMediaExecutionModeChange("sequential")}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[var(--fs-label)] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/25"
                    style={{
                        background: mediaExecutionMode === "sequential" ? theme.toolbar.itemHover : "transparent",
                        color: mediaExecutionMode === "sequential" ? theme.node.text : theme.node.muted,
                    }}
                    title="单步推进：每次提交一个生成任务，完成后再进入下一个"
                >
                    <StepForward className="size-3" aria-hidden="true" />
                    <span>单步推进</span>
                </button>
                <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={mediaExecutionMode === "parallel"}
                    onClick={() => onMediaExecutionModeChange("parallel")}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[var(--fs-label)] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/25"
                    style={{
                        background: mediaExecutionMode === "parallel" ? theme.toolbar.itemHover : "transparent",
                        color: mediaExecutionMode === "parallel" ? theme.node.text : theme.node.muted,
                    }}
                    title="全部并发：自动模式下把同一轮批量的多个生成任务并发提交进任务池"
                >
                    <Layers className="size-3" aria-hidden="true" />
                    <span>全部并发</span>
                </button>
            </div>

            <Popover open={open} onOpenChange={setOpen} trigger="click" placement="topRight" content={popoverContent}>
                <button
                    type="button"
                    className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-[var(--fs-label)] transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/25"
                    style={{ background: theme.node.fill, color: theme.node.text }}
                    aria-expanded={open}
                    title="预设本轮预算与默认生图/视频模型参数"
                >
                    <SlidersHorizontal className="size-3 shrink-0" style={{ color: theme.accent.primary }} aria-hidden="true" />
                    <span className="truncate">{summaryParts.join(" · ")}</span>
                </button>
            </Popover>
        </div>
    );
}
