import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { catalogFor, createPoseAssetSource, ID, poseGalleryPlugin, toItem } from "@/lib/plugins/builtin/pose-gallery/plugin";
import { mountGallery } from "@/lib/plugins/builtin/pose-gallery/entry.js";
import { pluginStorageFor } from "@/lib/plugins/plugin-storage";
import { isPluginEffectivelyEnabled, usePluginStore } from "@/stores/use-plugin-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { fetchPluginRuntimeState } from "@/services/api/plugins";
import { baseUrl, DEFAULT_BASE, DEFAULT_SYSTEMS } from "@/lib/plugins/builtin/pose-gallery/core.js";
import "@/lib/plugins/builtin/pose-gallery/gallery.css";

export default function PoseGalleryPage() {
    const root = useRef<HTMLDivElement>(null);
    const [runtimeReady, setRuntimeReady] = useState(false);
    const [error, setError] = useState("");
    const state = usePluginStore();
    const installation = state.installations.find(i => i.manifest.id === ID);
    const enabled = runtimeReady && isPluginEffectivelyEnabled(ID, installation?.enabled);
    useEffect(() => { state.ensurePlugin(poseGalleryPlugin.manifest); }, [state.ensurePlugin]);
    useEffect(() => {
        let cancelled = false;
        void fetchPluginRuntimeState().then(result => {
            if (cancelled) return;
            usePluginStore.getState().setPluginStates(result.states);
            usePluginStore.getState().setRuntimeStatuses(result.statuses);
            setRuntimeReady(true);
        }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "读取插件启用状态失败"); });
        return () => { cancelled = true; };
    }, []);
    useEffect(() => {
        if (!enabled || !installation || !root.current) return;
        const context = { manifest:poseGalleryPlugin.manifest, permissions:new Set(poseGalleryPlugin.manifest.permissions), storage:pluginStorageFor(ID), config:installation.config };
        const provider = createPoseAssetSource(context);
        return mountGallery(root.current, {
            catalog:catalogFor(installation.config),
            licenseText: typeof installation.config.licenseText === "string" ? installation.config.licenseText : undefined,
            onImport: async (row, signal) => {
                if (!isPluginEffectivelyEnabled(ID)) throw new Error("插件已停用");
                const asset = await provider.importAsset!(toItem(row), signal);
                signal?.throwIfAborted();
                if (!isPluginEffectivelyEnabled(ID)) throw new Error("插件已停用，未加入素材库");
                useAssetStore.getState().addAsset(asset);
            },
        });
    }, [enabled, installation]);
    return <main><div style={{padding:"16px 28px"}}><Link to="/plugins">← 插件中心</Link> · <Link to="/assets">素材库</Link></div>
        {error && <p role="alert" style={{padding:28}}>{error}</p>}
        {installation && <details style={{padding:"0 28px 16px"}}><summary>本账号图库设置</summary>
            <form key={installation.updatedAt} style={{display:"grid",gap:12,maxWidth:720,paddingTop:12}} onSubmit={event => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                try {
                    const base = baseUrl(String(data.get("baseUrl") || DEFAULT_BASE));
                    const systems = String(data.get("systems") || DEFAULT_SYSTEMS.join(","));
                    state.updateConfig(ID, {baseUrl:base,systems,licenseText:String(data.get("licenseText") || ""),autoUploadGenerated:false});
                    setError("");
                } catch (reason) { setError(reason instanceof Error ? reason.message : "配置无效"); }
            }}>
                <label>图库根目录 <input name="baseUrl" type="url" required defaultValue={String(installation.config.baseUrl || DEFAULT_BASE)} style={{width:"100%"}} /></label>
                <label>体系名称（英文逗号分隔） <input name="systems" defaultValue={String(installation.config.systems || DEFAULT_SYSTEMS.join(","))} style={{width:"100%"}} /></label>
                <label>素材授权说明 <input name="licenseText" defaultValue={String(installation.config.licenseText ?? "CC0 1.0 公有领域协议（免署名，完全支持商业使用）。")} style={{width:"100%"}} /></label>
                <button type="submit">保存本账号配置</button>
                <small>配置保存在影策当前账号的本机存储。启用权限仍由管理员控制。</small>
            </form></details>}
        {enabled ? <div ref={root} /> : <p style={{padding:28}}>请先由管理员上传并启用「AI姿势参考图库」插件，再返回本页。</p>}
    </main>;
}
