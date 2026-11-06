import { toast } from "sonner";
import { cameraErrorMessage } from "./media";
import { getState } from "./store";
import type { VoiceClient } from "./rtc";

function inRoom() {
  const s = getState();
  if (s.myChannel && s.voiceStatus === "connected") return true;
  toast("Entre em uma sala de vídeo primeiro.");
  return false;
}

export async function toggleCam(client: VoiceClient) {
  if (!inRoom()) return;
  const s = getState();
  try {
    if (s.camOn) await client.stopCam();
    else if (s.devices.cam === "none") toast("Escolha uma webcam nas configurações ou use o celular.");
    else await client.startCam(s.devices.cam);
  } catch (e) {
    toast.error(cameraErrorMessage(e));
  }
}

export async function toggleShare(client: VoiceClient) {
  if (!inRoom()) return;
  if (getState().sharing) return client.stopShare();
  try {
    await client.startShare();
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "NotAllowedError") return;
    if (name === "InvalidStateError") {
      // O Windows só abre o seletor de tela com um clique/tecla dentro do Pajé.
      toast("Para começar, aperte o atalho com o Pajé em foco ou clique em Transmitir.");
      return;
    }
    toast.error(e instanceof Error ? e.message : "Não foi possível iniciar a transmissão.");
  }
}
