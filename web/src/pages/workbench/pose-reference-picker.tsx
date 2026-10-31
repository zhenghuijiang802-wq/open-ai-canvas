import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { catalogFor, ID, poseGalleryPlugin } from "@/lib/plugins/builtin/pose-gallery/plugin";
import { mountGallery } from "@/lib/plugins/builtin/pose-gallery/entry.js";
import { fetchPluginRuntimeState } from "@/services/api/plugins";
import { isPluginEffectivelyEnabled, usePluginStore } from "@/stores/use-plugin-store";
import "@/lib/plugins/builtin/pose-gallery/gallery.css";
import "./pose-reference-picker.css";

type Slot = { key: string; name: string; remaining: number };
type Props = { slots: Slot[]; onClose: () => void; onSelect: (file: File, slotKey: string) => Promise<void> };

export function PoseReferencePicker({ slots, onClose, onSelect }: Props) {
    const root = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState("");
    const [slotKey, setSlotKey] = useState(() => slots.find((slot) => slot.remaining > 0)?.key || slots[0]?.key || "");
    const state = usePluginStore();
    const installation = state.installations.find((item) => item.manifest.id === ID);
    const enabled = ready && isPluginEffectivelyEnabled(ID, installation?.enabled);
    const current = useRef({ slots, slotKey, onSelect });
    current.current = { slots, slotKey, onSelect };

    useEffect(() => {
        state.ensurePlugin(poseGalleryPlugin.manifest);
    }, [state.ensurePlugin]);
    useEffect(() => {
        let cancelled = false;
        void fetchPluginRuntimeState()
            .then((result) => {
                if (cancelled) return;
                usePluginStore.getState().setPluginStates(result.states);
                usePluginStore.getState().setRuntimeStatuses(result.statuses);
                setReady(true);
            })
            .catch((reason) => {
                if (!cancelled) setError(reason instanceof Error ? reason.message : "无法读取图库状态，请关闭后重试");
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!enabled || !installation || !root.current) return;
        const catalog = catalogFor(installation.config);
        return mountGallery(root.current, {
            catalog,
            importLabel: "用作参考图",
            importSuccessText: "已加入当前参考图",
            licenseText: typeof installation.config.licenseText === "string" ? installation.config.licenseText : undefined,
            onImport: async (row, signal) => {
                const selection = current.current;
                const slot = selection.slots.find((item) => item.key === selection.slotKey);
                if (!slot || slot.remaining < 1) throw new Error("当前参考图数量已达上限，请先移除一张或选择其他素材位置");
                if (!isPluginEffectivelyEnabled(ID)) throw new Error("姿势图库已停用");
                const blob = await catalog.download(row.id, signal);
                signal.throwIfAborted();
                if (!isPluginEffectivelyEnabled(ID)) throw new Error("姿势图库已停用");
                const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
                await selection.onSelect(new File([blob], `姿势-${row.code}-${row.angle}.${extension}`, { type: blob.type }), slot.key);
            },
        });
    }, [enabled, installation]);

    return (
        <AppModal open title="选择姿势参考图" onCancel={onClose} footer={null} width="min(1100px, calc(100vw - 24px))" className="workbench-pose-modal">
            <div className="workbench-pose-intro">
                <p>选择动作与视角，将原图加入参考素材。提示词由你决定。</p>
                {slots.length > 1 ? (
                    <label>
                        添加到{" "}
                        <select aria-label="姿势参考图添加位置" value={slotKey} onChange={(event) => setSlotKey(event.target.value)}>
                            {slots.map((slot) => (
                                <option key={slot.key} value={slot.key} disabled={slot.remaining < 1}>
                                    {slot.name}（可添加 {slot.remaining} 张）
                                </option>
                            ))}
                        </select>
                    </label>
                ) : null}
            </div>
            {error ? (
                <p role="alert">{error}</p>
            ) : !ready ? (
                <p role="status">正在加载姿势图库…</p>
            ) : !enabled ? (
                <p>
                    姿势图库尚未启用，请到<Link to="/plugins">插件中心</Link>启用“AI姿势参考图库”。
                </p>
            ) : null}
            {enabled ? <div ref={root} className="workbench-pose-gallery" /> : null}
        </AppModal>
    );
}
