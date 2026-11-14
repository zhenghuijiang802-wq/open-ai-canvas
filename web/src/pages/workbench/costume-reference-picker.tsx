import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Select } from "antd";
import { Search } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { MediaPreview } from "@/components/media-preview";
import { COSTUME_CATEGORIES, COSTUME_GALLERY_URL, costumeImageUrl, filterCostumes, type Costume } from "@/lib/costume-gallery";
import { downloadCostume, loadCostumeCatalog } from "@/services/costume-gallery";
import "./costume-reference-picker.css";

type Slot = { key: string; name: string; remaining: number };
export function CostumeReferencePicker({ slots, onClose, onSelect }: { slots: Slot[]; onClose: () => void; onSelect: (file: File, slotKey: string) => Promise<void> }) {
    const [rows, setRows] = useState<Costume[]>([]), [category, setCategory] = useState(""), [query, setQuery] = useState("");
    const [selected, setSelected] = useState<Costume>(), [limit, setLimit] = useState(60), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [slotKey, setSlotKey] = useState(() => slots.find(slot => slot.remaining > 0)?.key || slots[0]?.key || "");
    const session = useRef<AbortController | null>(null), submitting = useRef(false);
    const current = useRef({ slots, slotKey, onSelect }); current.current = { slots, slotKey, onSelect };
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        const controller = new AbortController(); session.current = controller;
        setLoading(true); setError("");
        void loadCostumeCatalog(controller.signal).then(setRows).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "服装目录加载失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [retry]);
    const filtered = useMemo(() => filterCostumes(rows, category, query), [rows, category, query]);
    const slot = slots.find(item => item.key === slotKey);
    const choose = async () => {
        const controller = session.current;
        if (!selected || !controller || controller.signal.aborted || submitting.current) return;
        submitting.current = true; setBusy(true); setError("");
        try {
            if (!current.current.slots.some(item => item.key === current.current.slotKey && item.remaining > 0)) throw new Error("当前参考图数量已达上限，请先移除一张参考图");
            const target = current.current.slotKey;
            const file = await downloadCostume(selected.id, controller.signal);
            if (!current.current.slots.some(item => item.key === target && item.remaining > 0)) throw new Error("当前参考图数量已达上限");
            await current.current.onSelect(file, target);
        } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "服装参考图添加失败"); }
        finally { submitting.current = false; if (!controller.signal.aborted) setBusy(false); }
    };
    return <AppModal open title="选择服装参考图" onCancel={onClose} footer={null} width="min(1100px, calc(100vw - 24px))" className="workbench-costume-modal">
        <div className="costume-picker">
            <p className="costume-intro">选择服装原图加入参考素材，可配合人物、姿势图片一起使用。</p>
            <div className="costume-filters">
                <Select aria-label="服装分类" value={category} onChange={value => { setCategory(value); setLimit(60); }} options={[{ value: "", label: `全部服装 (${rows.length})` }, ...Object.entries(COSTUME_CATEGORIES).map(([value, label]) => ({ value, label }))]} />
                <Input aria-label="搜索服装" placeholder="搜索编号、颜色或服装，如：白色、denim" prefix={<Search size={14} />} value={query} onChange={event => { setQuery(event.target.value); setLimit(60); }} allowClear />
                {slots.length > 1 ? <Select aria-label="服装参考图添加位置" value={slotKey} onChange={setSlotKey} disabled={busy} options={slots.map(item => ({ value: item.key, label: `${item.name}（可添加 ${item.remaining} 张）`, disabled: item.remaining < 1 }))} /> : null}
            </div>
            {error ? <div role="alert" className="costume-error">{error}{!rows.length ? <Button onClick={() => setRetry(value => value + 1)}>重试</Button> : null}</div> : null}
            <div className={`costume-body${selected ? " has-selection" : ""}`}>
                <div className="costume-scroll">
                    <p role="status">{loading ? "正在加载服装图库…" : `找到 ${filtered.length} 套服装`}</p>
                    {!loading && !filtered.length ? <p>没有匹配的服装，试试其他分类或关键词。</p> : null}
                    <div className="costume-grid">{filtered.slice(0, limit).map(row => <button type="button" key={row.id} className="costume-card" aria-label={`预览服装 ${row.id}`} aria-pressed={selected?.id === row.id} onClick={() => setSelected(row)} disabled={busy}>
                        <span className="costume-thumb"><MediaPreview src={costumeImageUrl(row.id, "thumbs")} kind="image" loading="lazy" alt={`${COSTUME_CATEGORIES[row.category]} ${row.id}`} /></span>
                        <span><strong>{row.id}</strong><small>{COSTUME_CATEGORIES[row.category]}</small></span>
                    </button>)}</div>
                    {filtered.length > limit ? <Button block onClick={() => setLimit(value => value + 60)}>加载更多（剩余 {filtered.length - limit} 套）</Button> : null}
                </div>
                {selected ? <aside className="costume-detail" aria-label="服装预览">
                    <div className="costume-preview"><MediaPreview key={selected.id} src={costumeImageUrl(selected.id, "img")} kind="image" alt={selected.id} /></div>
                    <div><strong>{selected.id}</strong> · {COSTUME_CATEGORIES[selected.category]}</div><p>{selected.keywords}</p>
                    <Button type="primary" block loading={busy} disabled={!slot || slot.remaining < 1} onClick={() => void choose()}>用作参考图</Button>
                    {!slot || slot.remaining < 1 ? <p>参考图数量已达上限，请先移除一张。</p> : null}
                </aside> : null}
            </div>
            <p className="costume-credit">来源：<a href={COSTUME_GALLERY_URL} target="_blank" rel="noreferrer">AI Costume Gallery · ギア</a>。可用于作品参考；禁止图片批量下载、再分发或转售。</p>
        </div>
    </AppModal>;
}
