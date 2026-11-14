import { getActiveUserScope, scopedStorageKey } from "@/lib/user-scope";
import type { AgentMediaDefaults, AgentMediaExecutionMode, AgentMediaSettings, AgentPermissionMode } from "@/services/api/agent";

export type AgentRunPreferences = {
    permissionMode: AgentPermissionMode;
    mediaExecutionMode: AgentMediaExecutionMode;
    maxCredits: string;
    maxGenerationTasks: string;
    maxVideoSeconds: string;
    mediaDefaults: AgentMediaDefaults;
};

const STORAGE_NAME = "cloud-agent-run-defaults:v1";

export const DEFAULT_AGENT_RUN_PREFERENCES: AgentRunPreferences = {
    permissionMode: "auto",
    mediaExecutionMode: "sequential",
    maxCredits: "200",
    maxGenerationTasks: "0",
    maxVideoSeconds: "0",
    mediaDefaults: {},
};

function sanitizePermissionMode(value: unknown): AgentPermissionMode {
    if (value === "auto" || value === "request_approval" || value === "read_only") return value;
    return DEFAULT_AGENT_RUN_PREFERENCES.permissionMode;
}

function sanitizeExecutionMode(value: unknown): AgentMediaExecutionMode {
    if (value === "sequential" || value === "parallel") return value;
    return DEFAULT_AGENT_RUN_PREFERENCES.mediaExecutionMode;
}

function sanitizePositiveNumericString(value: unknown, fallback: string) {
    if (typeof value !== "string") return fallback;
    const digits = value.replace(/[^0-9]/g, "");
    return digits || fallback;
}

function sanitizeMediaSettings(value: unknown): AgentMediaSettings | undefined {
    if (!value || typeof value !== "object") return undefined;
    const raw = value as Record<string, unknown>;
    const next: AgentMediaSettings = {
        size: typeof raw.size === "string" ? raw.size : "",
        quality: typeof raw.quality === "string" ? raw.quality : "",
    };
    if (typeof raw.logicalModelId === "string" && raw.logicalModelId) next.logicalModelId = raw.logicalModelId;
    if (typeof raw.channelId === "string" && raw.channelId) next.channelId = raw.channelId;
    if (typeof raw.channelModelKey === "string" && raw.channelModelKey) next.channelModelKey = raw.channelModelKey;
    if (typeof raw.imageResolution === "string" && raw.imageResolution) next.imageResolution = raw.imageResolution;
    if (typeof raw.imageParameters === "string" && raw.imageParameters) next.imageParameters = raw.imageParameters;
    if (typeof raw.durationSeconds === "number" && Number.isFinite(raw.durationSeconds) && raw.durationSeconds >= 0) next.durationSeconds = Math.trunc(raw.durationSeconds);
    if (typeof raw.videoGenerateAudio === "boolean") next.videoGenerateAudio = raw.videoGenerateAudio;
    if (typeof raw.videoWatermark === "boolean") next.videoWatermark = raw.videoWatermark;
    if (typeof raw.videoArkPrivateAssetUpload === "boolean") next.videoArkPrivateAssetUpload = raw.videoArkPrivateAssetUpload;
    return next;
}

export function loadAgentRunPreferences(scope = getActiveUserScope()): AgentRunPreferences {
    if (typeof window === "undefined") return { ...DEFAULT_AGENT_RUN_PREFERENCES, mediaDefaults: {} };
    try {
        const raw = window.localStorage.getItem(scopedStorageKey(STORAGE_NAME, scope));
        if (!raw) return { ...DEFAULT_AGENT_RUN_PREFERENCES, mediaDefaults: {} };
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const defaultsRaw = parsed.mediaDefaults && typeof parsed.mediaDefaults === "object" ? (parsed.mediaDefaults as Record<string, unknown>) : {};
        const image = sanitizeMediaSettings(defaultsRaw.image);
        const video = sanitizeMediaSettings(defaultsRaw.video);
        return {
            permissionMode: sanitizePermissionMode(parsed.permissionMode),
            mediaExecutionMode: sanitizeExecutionMode(parsed.mediaExecutionMode),
            maxCredits: sanitizePositiveNumericString(parsed.maxCredits, DEFAULT_AGENT_RUN_PREFERENCES.maxCredits),
            maxGenerationTasks: sanitizePositiveNumericString(parsed.maxGenerationTasks, DEFAULT_AGENT_RUN_PREFERENCES.maxGenerationTasks),
            maxVideoSeconds: sanitizePositiveNumericString(parsed.maxVideoSeconds, DEFAULT_AGENT_RUN_PREFERENCES.maxVideoSeconds),
            mediaDefaults: {
                ...(image ? { image } : {}),
                ...(video ? { video } : {}),
            },
        };
    } catch {
        return { ...DEFAULT_AGENT_RUN_PREFERENCES, mediaDefaults: {} };
    }
}

export function saveAgentRunPreferences(preferences: AgentRunPreferences, scope = getActiveUserScope()) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(scopedStorageKey(STORAGE_NAME, scope), JSON.stringify(preferences));
    } catch {
        // Ignore quota errors for small preference persistence.
    }
}

export function compactAgentMediaDefaults(defaults?: AgentMediaDefaults): AgentMediaDefaults | undefined {
    if (!defaults) return undefined;
    const hasFields = (settings?: AgentMediaSettings) =>
        Boolean(
            settings &&
            (settings.logicalModelId ||
                (settings.channelId && settings.channelModelKey) ||
                settings.size ||
                settings.quality ||
                settings.imageResolution ||
                settings.imageParameters ||
                settings.durationSeconds !== undefined ||
                settings.videoGenerateAudio !== undefined ||
                settings.videoWatermark !== undefined ||
                settings.videoArkPrivateAssetUpload !== undefined),
        );
    const next: AgentMediaDefaults = {};
    if (hasFields(defaults.image)) next.image = defaults.image;
    if (hasFields(defaults.video)) next.video = defaults.video;
    return next.image || next.video ? next : undefined;
}
