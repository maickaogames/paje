import { useEffect, useState } from "react";
import { Camera, Mic, Volume2 } from "lucide-react";
import { MEDIA_FEATURES } from "@/lib/media-policy";
import { listDevices, type DeviceLists } from "@/lib/media";
import type { Devices } from "@/lib/store";

function DeviceSelect({
  icon,
  label,
  value,
  onChange,
  options,
  allowDefault,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: MediaDeviceInfo[];
  allowDefault: boolean;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
        {icon} {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 rounded-md bg-surface border border-input px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="none">Nenhum (desativado)</option>
        {allowDefault && <option value="default">Padrão do sistema</option>}
        {options.filter((d) => d.deviceId).map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DeviceForm({ value, onChange }: { value: Devices; onChange: (d: Devices) => void }) {
  const [lists, setLists] = useState<DeviceLists>({ mics: [], speakers: [], cams: [] });

  useEffect(() => {
    let alive = true;
    listDevices().then((l) => alive && setLists(l));
    const refresh = () => listDevices().then((l) => alive && setLists(l));
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
    };
  }, []);

  return (
    <div className="grid gap-4">
      {MEDIA_FEATURES.voice && <DeviceSelect
        icon={<Mic className="h-3.5 w-3.5" />}
        label="Microfone"
        value={value.mic}
        onChange={(mic) => onChange({ ...value, mic })}
        options={lists.mics}
        allowDefault
      />}
      <DeviceSelect
        icon={<Volume2 className="h-3.5 w-3.5" />}
        label="Saída de áudio"
        value={value.speaker}
        onChange={(speaker) => onChange({ ...value, speaker })}
        options={lists.speakers}
        allowDefault
      />
      <DeviceSelect
        icon={<Camera className="h-3.5 w-3.5" />}
        label="Webcam"
        value={value.cam}
        onChange={(cam) => onChange({ ...value, cam })}
        options={lists.cams}
        allowDefault
      />
    </div>
  );
}
