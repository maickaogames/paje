import { useSyncExternalStore } from "react";

/* ---------- Types ---------- */

export type ChannelId = "gameplay-1" | "gameplay-2" | "afk";
export const VOICE_CHANNELS: { id: ChannelId; name: string; autoMute?: boolean }[] = [
  { id: "gameplay-1", name: "Gameplay 1" },
  { id: "gameplay-2", name: "Gameplay 2" },
  { id: "afk", name: "AFK", autoMute: true },
];

export type DeviceChoice = string | "none" | "default";

export interface Profile {
  peerId: string;
  nickname: string;
  avatar: string | null; // small data URL
}

export interface Devices {
  mic: DeviceChoice;
  speaker: DeviceChoice;
  cam: DeviceChoice;
}

export interface Settings {
  ptt: boolean;
  pttKey: string;
  muteKey: string;
  deafenKey: string;
  powerSave: boolean;
  vadThreshold: number; // 0..1 RMS
  micGain: number; // 0.2..3 ganho do microfone
  noiseSuppression: boolean;
  micMonitor: boolean; // ouvir o próprio microfone
}

export interface Member {
  peerId: string;
  nickname: string;
  avatar: string | null;
  channel: ChannelId | null;
  muted: boolean;
  deafened: boolean;
  micStream: string | null;
  camStream: string | null;
  screenStream: string | null;
}

export interface RemoteStreams {
  mic?: MediaStream | undefined;
  cam?: MediaStream | undefined;
  screen?: MediaStream | undefined;
}

export interface AppState {
  token: string | null;
  profile: Profile | null;
  devices: Devices;
  settings: Settings;
  connected: boolean;

  members: Record<string, Member>;
  myChannel: ChannelId | null;
  view: "text" | ChannelId;

  muted: boolean;
  deafened: boolean;
  pttHeld: boolean;
  camOn: boolean;
  sharing: boolean;

  speaking: Record<string, boolean>;
  volumes: Record<string, number>; // 0..2
  pings: Record<string, number>;
  quality: Record<string, "good" | "fair" | "poor">;
  streams: Record<string, RemoteStreams>;
  localCam: MediaStream | null;
  localScreen: MediaStream | null;
  screenVolume: number;
  watching: string | null; // peerId whose screen is focused
  phoneCamConnected: boolean;
  hidden: boolean; // tab hidden → power save
  voiceStatus: "idle" | "connecting" | "connected" | "reconnecting" | "failed";
  audioBlocked: boolean; // navegador bloqueou a reprodução automática
  helperStatus: "off" | "connecting" | "ready" | "capturing" | "unavailable";
  helperProcesses: { pid: number; name: string }[];
  helperPid: number | null;
}

/* ---------- Persistence ---------- */

const LS_KEY = "litevoice:v1";

function loadPersisted(): Partial<Pick<AppState, "token" | "profile" | "devices" | "settings">> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persist(s: AppState) {
  if (typeof window === "undefined") return;
  const { token, profile, devices, settings } = s;
  window.localStorage.setItem(LS_KEY, JSON.stringify({ token, profile, devices, settings }));
}

export function newPeerId() {
  return Math.random().toString(36).slice(2, 10);
}

const defaults: AppState = {
  token: null,
  profile: null,
  devices: { mic: "none", speaker: "default", cam: "default" },
  settings: {
    ptt: false,
    pttKey: "KeyV",
    muteKey: "F8",
    deafenKey: "F9",
    powerSave: true,
    vadThreshold: 0.02,
    micGain: 1,
    noiseSuppression: true,
    micMonitor: false,
  },
  connected: false,
  members: {},
  myChannel: null,
  view: "gameplay-1",
  muted: true,
  deafened: false,
  pttHeld: false,
  camOn: false,
  sharing: false,
  speaking: {},
  volumes: {},
  pings: {},
  quality: {},
  streams: {},
  localCam: null,
  localScreen: null,
  screenVolume: 1,
  watching: null,
  phoneCamConnected: false,
  hidden: false,
  voiceStatus: "idle",
  audioBlocked: false,
  helperStatus: "off",
  helperProcesses: [],
  helperPid: null,
};

/* ---------- Tiny store ---------- */

let state: AppState = { ...defaults, ...loadPersisted() };
const listeners = new Set<() => void>();

export function getState() {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  if ("token" in next || "profile" in next || "devices" in next || "settings" in next) persist(state);
  listeners.forEach((l) => l());
}

export function subscribeState(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribeState,
    () => selector(state),
    () => selector(state),
  );
}

export function resetSession() {
  setState({ token: null, profile: null });
}
