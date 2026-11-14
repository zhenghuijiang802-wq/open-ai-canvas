import { Progress, Select } from "antd";
import { Mic, X } from "lucide-react";
import { MediaPreview } from "@/components/media-preview";
import type { WorkbenchKind } from "@/services/api/workbench";
import type { WorkbenchReference } from "./workbench-assets";

export function ReferenceCard({ reference, kind, onPreview, onRemove, onRoleChange, disabled = false, errorLabel = "上传失败" }: {
    reference: WorkbenchReference;
    kind: WorkbenchKind;
    onPreview: (reference: WorkbenchReference) => void;
    onRemove: (reference: WorkbenchReference) => void;
    onRoleChange?: (role: WorkbenchReference["role"]) => void;
    disabled?: boolean;
    errorLabel?: string;
}) {
    return (
        <div className="workbench-reference">
            <button type="button" className="workbench-reference-preview-trigger" aria-label={`预览${reference.name}`} onClick={() => onPreview(reference)} disabled={!reference.previewUrl}>
                {reference.kind === "audio" ? <span className="workbench-audio-reference"><Mic /></span> : <MediaPreview src={reference.previewUrl} kind={reference.kind} alt={reference.name} />}
            </button>
            {reference.uploading ? <Progress type="circle" percent={Math.round(reference.progress)} size={34} /> : null}
            {reference.error ? <span className="workbench-reference-error" title={reference.error}>{errorLabel}</span> : null}
            <button type="button" className="workbench-reference-remove" aria-label={`移除${reference.name}`} onClick={() => onRemove(reference)} disabled={disabled}><X /></button>
            {kind === "video" && reference.kind === "image" && !reference.slotKey ? <Select size="small" value={reference.role} onChange={onRoleChange} disabled={disabled} options={[{ label: "参考图", value: "reference" }, { label: "首帧", value: "first_frame" }, { label: "尾帧", value: "last_frame" }]} /> : null}
        </div>
    );
}
