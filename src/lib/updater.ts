import { checkUpdate, installUpdate, isDesktop } from "./desktop";
import { getState, setState } from "./store";

export function isUpdateAvailable(current: number, latest: number) {
  return latest > current;
}

/**
 * Fluxo único usado ao abrir o app e no botão "Atualizar Pajé":
 * verificando → atualizado, ou baixando (com %) → reiniciando.
 */
export async function runUpdate() {
  const phase = getState().update.phase;
  if (phase === "checking" || phase === "downloading" || phase === "restarting") return;
  setState({ update: { phase: "checking", percent: 0 } });
  // Na versão web a página já carrega sempre a última versão publicada.
  if (!isDesktop()) {
    await new Promise((r) => setTimeout(r, 600));
    setState({ update: { phase: "uptodate", percent: 100 } });
    return;
  }
  try {
    const info = await checkUpdate();
    if (!isUpdateAvailable(info.current, info.latest)) {
      setState({ update: { phase: "uptodate", percent: 100 } });
      return;
    }
    setState({ update: { phase: "downloading", percent: 0 } });
    await installUpdate(info.url, (percent) => setState({ update: { phase: "downloading", percent } }));
    setState({ update: { phase: "restarting", percent: 100 } });
  } catch (e) {
    console.warn("[update]", e);
    setState({ update: { phase: "error", percent: 0 } });
  }
}

export function dismissUpdate() {
  setState({ update: { phase: "idle", percent: 0 } });
}
