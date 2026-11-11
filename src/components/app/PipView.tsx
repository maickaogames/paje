import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_PIP, useApp } from "@/lib/store";
import { closePip } from "@/lib/pip";
import { Video } from "./VoiceView";
import { camFxStyle, type CamFx } from "@/lib/camfx";

/** Conteúdo do Picture-in-Picture: transmissão assistida e/ou câmeras, conforme as configurações. */
export function PipView() {
  const pip = useApp((s) => s.settings.pip ?? DEFAULT_PIP);
  const members = useApp((s) => s.members);
  const me = useApp((s) => s.profile?.peerId ?? "");
  const myChannel = useApp((s) => s.myChannel);
  const watching = useApp((s) => s.watching);
  const streams = useApp((s) => s.streams);
  const localCam = useApp((s) => s.localCam);
  const localScreen = useApp((s) => s.localScreen);
  const phoneCam = useApp((s) => s.phoneCamConnected);
  const myFx = useApp((s) => s.settings.camFx);

  const screen = watching ? (watching === me ? localScreen : streams[watching]?.screen) : undefined;
  const cams = Object.values(members)
    .filter((m) => m.channel === myChannel && (m.peerId !== me || pip.includeMe || pip.content === "one"))
    .map((m) => ({ id: m.peerId, name: m.nickname, stream: m.peerId === me ? localCam : streams[m.peerId]?.cam, fx: m.peerId === me ? myFx : m.camFx }))
    .filter((c): c is { id: string; name: string; stream: MediaStream; fx: CamFx | undefined } => !!c.stream);

  const showScreen = (pip.content === "all" || pip.content === "screen") && screen;
  let camList = pip.content === "all" || pip.content === "cams" ? cams : [];
  if (pip.content === "one") {
    const chosen = cams.find((c) => c.id === pip.peer) ?? cams.find((c) => c.id !== me);
    camList = chosen ? [chosen] : [];
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background text-foreground group">
      {showScreen ? (
        <>
          <Video stream={screen} className="object-contain" />
          {camList.length > 0 && (
            <div className="absolute right-1.5 bottom-1.5 flex gap-1.5">
              {camList.slice(0, 4).map((c) => (
                <div key={c.id} className="h-16 aspect-video rounded-md overflow-hidden bg-tile ring-1 ring-border">
                  <Video stream={c.stream} className="object-contain" style={camFxStyle(c.fx, c.id === me && !phoneCam)} />
                </div>
              ))}
            </div>
          )}
        </>
      ) : camList.length > 0 ? (
        <div className={cn("grid h-full w-full gap-1 p-1", camList.length > 1 && "grid-cols-2")}>
          {camList.map((c) => (
            <div key={c.id} className="relative min-h-0 rounded-md overflow-hidden bg-tile">
              <Video stream={c.stream} className="object-contain" style={camFxStyle(c.fx, c.id === me && !phoneCam)} />
              <span className="absolute left-1 bottom-1 rounded bg-background/70 px-1.5 text-[11px]">{c.name}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="h-full grid place-items-center p-4 text-center text-sm text-muted-foreground">
          {pip.content === "screen" ? "Assista a uma transmissão para vê-la aqui." : "Nenhuma câmera ou transmissão ativa."}
        </div>
      )}
      <button
        type="button"
        onClick={() => void closePip()}
        aria-label="Fechar Picture-in-Picture"
        className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-md bg-background/80 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
