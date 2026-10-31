import { createClientUUID } from "@/lib/client-id";
import { getActiveUserScope } from "@/lib/user-scope";
import { validateComicStyleSelection } from "@/lib/canvas/comic-style";
import { createStyleProfileSnapshot, parseStyleProfile, serializeStyleProfile, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";
import { createStyleProfile, listStyleProfiles, updateStyleProfile, type UserStyleProfile } from "@/services/api/style-profiles";
import { getResource, resourceFileUrl, uploadResourceFile } from "@/services/api/resources";

const styleReferenceAssetId = "comic-style-reference";
export type ComicStyleLibraryItem = {
    id: string; title: string; prompt: string; coverUrl?: string; referenceResourceId?: string;
    profile: StyleProfileSnapshot; revision: number; disabledReason?: string;
};
export type SaveComicStyleInput = {
    id?: string; title: string; prompt: string; coverUrl?: string; referenceResourceId?: string; expectedRevision?: number;
};

function guardScope(scope: string) {
    if (scope !== getActiveUserScope()) throw new Error("账号已切换，已停止当前画风操作");
}

function libraryItem(entity: UserStyleProfile): ComicStyleLibraryItem | null {
    const profile = parseStyleProfile(entity.profileJson);
    if (!profile) return null;
    const reference = profile.assets.find((asset) => asset.id === styleReferenceAssetId && asset.kind === "reference" && asset.enabled !== false && asset.status === "validated");
    const item: ComicStyleLibraryItem = { id: entity.id, title: profile.title, prompt: profile.prompt, coverUrl: profile.coverUrl, referenceResourceId: reference?.referenceResourceIds?.[0], profile, revision: entity.revision };
    if (Array.from(item.prompt).length > 1000) item.disabledReason = "画风提示词超过 1000 字，请编辑精简后使用";
    else if (profile.negativePrompt?.trim() || profile.assets.some((asset) => asset.enabled !== false && asset.id !== styleReferenceAssetId)) item.disabledReason = "此风格包含额外执行配置，请在原画风库中调整后使用";
    else {
        try { validateComicStyleSelection({ id: item.id, title: item.title, ...(item.coverUrl ? { coverUrl: item.coverUrl } : {}), ...(item.referenceResourceId ? { referenceResourceId: item.referenceResourceId } : {}) }); }
        catch { item.disabledReason = "此风格封面暂不支持，请编辑并重新上传画风图"; }
    }
    return item;
}

export async function listComicStyles(): Promise<ComicStyleLibraryItem[]> {
    const scope = getActiveUserScope();
    const result = await listStyleProfiles();
    guardScope(scope);
    return result.profiles.flatMap((entity) => { const item = libraryItem(entity); return item ? [item] : []; });
}

export async function uploadComicStyleImage(file: File): Promise<{ coverUrl: string; referenceResourceId: string }> {
    if (!/^image\/(?:png|jpeg|webp)$/i.test(file.type)) throw new Error("画风图支持 PNG、JPEG 或 WebP 图片");
    if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("请上传 20 MB 以内的画风图片");
    const scope = getActiveUserScope();
    const resource = await uploadResourceFile(file, "image", { fileName: file.name });
    guardScope(scope);
    if (resource.kind !== "image" || resource.status !== "ready") throw new Error("画风图片尚未上传完成，请重试");
    const selection = validateComicStyleSelection({ id: "upload", title: "画风图", coverUrl: resourceFileUrl(resource.id), referenceResourceId: resource.id });
    return { coverUrl: selection.coverUrl!, referenceResourceId: selection.referenceResourceId! };
}

export async function saveComicStyle(input: SaveComicStyleInput): Promise<ComicStyleLibraryItem> {
    const scope = getActiveUserScope();
    const title = input.title.trim(), prompt = input.prompt.trim();
    if (!title || Array.from(title).length > 80) throw new Error("画风名称须为 1–80 字");
    if (!prompt || Array.from(prompt).length > 1000) throw new Error("画风提示词须为 1–1000 字");
    validateComicStyleSelection({ id: input.id || "new-style", title, ...(input.coverUrl ? { coverUrl: input.coverUrl } : {}), ...(input.referenceResourceId ? { referenceResourceId: input.referenceResourceId } : {}) });
    let existing: UserStyleProfile | undefined;
    let previous: StyleProfileSnapshot | null = null;
    if (input.id) {
        existing = (await listStyleProfiles()).profiles.find((profile) => profile.id === input.id);
        guardScope(scope);
        if (!existing) throw new Error("画风已不存在，请刷新画风库");
        if (input.expectedRevision !== undefined && existing.revision !== input.expectedRevision) throw new Error("画风已被其他操作更新，请重新打开编辑");
        previous = parseStyleProfile(existing.profileJson);
        if (!previous) throw new Error("已有画风数据无法读取，未覆盖原配置");
    }
    const resourceIds = new Set<string>([
        ...(input.referenceResourceId ? [input.referenceResourceId] : []),
        ...(input.coverUrl?.match(/^\/api\/resources\/([A-Za-z0-9_-]{1,80})\/file$/)?.[1] ? [input.coverUrl.match(/^\/api\/resources\/([A-Za-z0-9_-]{1,80})\/file$/)![1]] : []),
    ]);
    for (const resourceId of resourceIds) {
        const resource = await getResource(resourceId);
        guardScope(scope);
        if (resource.kind !== "image" || resource.status !== "ready") throw new Error("画风图片不存在或尚未就绪，请重新上传");
    }
    const profile = createStyleProfileSnapshot({
        ...(previous || { presetId: `comic-${createClientUUID()}`, description: "漫画制作自定义画风", tags: ["漫画画风"], source: "user" as const, revision: 1 }),
        title, prompt, coverUrl: input.coverUrl,
        assets: [
            ...(previous?.assets.filter((asset) => asset.id !== styleReferenceAssetId) || []),
            ...(input.referenceResourceId ? [{ id: styleReferenceAssetId, kind: "reference" as const, provider: "yingce", title: "漫画统一画风参考", enabled: true, referenceResourceIds: [input.referenceResourceId], status: "validated" as const }] : []),
        ],
    });
    guardScope(scope);
    const result = input.id ? await updateStyleProfile(input.id, serializeStyleProfile(profile)) : await createStyleProfile(serializeStyleProfile(profile));
    guardScope(scope);
    const item = libraryItem(result.profile);
    if (!item) throw new Error("画风已保存，但返回内容无法读取，请刷新画风库");
    return item;
}
