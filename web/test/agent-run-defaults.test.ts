import { describe, expect, test } from "bun:test";

import { compactAgentMediaDefaults, DEFAULT_AGENT_RUN_PREFERENCES, loadAgentRunPreferences, saveAgentRunPreferences } from "@/lib/canvas/agent-run-defaults";

describe("agent run defaults", () => {
    test("defaults new runs to auto execution and sequential media scheduling", () => {
        expect(DEFAULT_AGENT_RUN_PREFERENCES.permissionMode).toBe("auto");
        expect(DEFAULT_AGENT_RUN_PREFERENCES.mediaExecutionMode).toBe("sequential");
    });

    test("compacts empty media defaults cleanly", () => {
        expect(compactAgentMediaDefaults({})).toBeUndefined();
        expect(compactAgentMediaDefaults({ image: { size: "", quality: "" } })).toBeUndefined();
        expect(compactAgentMediaDefaults({ image: { logicalModelId: "flux", size: "1:1", quality: "" } })).toEqual({
            image: { logicalModelId: "flux", size: "1:1", quality: "" },
        });
    });

    test("falls back safely when storage is unavailable", () => {
        const originalWindow = (globalThis as { window?: unknown }).window;
        const backing = new Map<string, string>();
        (globalThis as { window?: unknown }).window = {
            localStorage: {
                getItem: (key: string) => backing.get(key) ?? null,
                setItem: (key: string, value: string) => {
                    backing.set(key, value);
                },
            },
        };
        try {
            saveAgentRunPreferences(
                {
                    permissionMode: "request_approval",
                    mediaExecutionMode: "parallel",
                    maxCredits: "500",
                    maxGenerationTasks: "8",
                    maxVideoSeconds: "60",
                    mediaDefaults: { video: { channelId: "ch", channelModelKey: "seedance", size: "9:16", quality: "720p" } },
                },
                "user-a",
            );
            const loaded = loadAgentRunPreferences("user-a");
            expect(loaded.permissionMode).toBe("request_approval");
            expect(loaded.mediaExecutionMode).toBe("parallel");
            expect(loaded.maxCredits).toBe("500");
            expect(loaded.mediaDefaults.video?.size).toBe("9:16");
            expect(loadAgentRunPreferences("user-b").permissionMode).toBe("auto");
        } finally {
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else (globalThis as { window?: unknown }).window = originalWindow;
        }
    });
});
