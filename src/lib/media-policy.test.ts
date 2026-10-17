import { describe, expect, test } from "bun:test";
import { MEDIA_FEATURES, MEDIA_PUBLISH_SOURCES, shouldSubscribeMedia, shouldPlayScreenAudio, safeScreenAudio, assertTextEnabled } from "./media-policy";

describe("Pajé alongside Discord", () => {
  test("voice is temporarily disabled and microphone publication is excluded", () => {
    expect(MEDIA_FEATURES.voice).toBe(false);
    expect([...MEDIA_PUBLISH_SOURCES]).toEqual(["camera", "screen_share", "screen_share_audio"]);
    expect(shouldSubscribeMedia("microphone", "friend", "friend")).toBe(false);
  });
  test("text chat is temporarily disabled", () => {
    expect(MEDIA_FEATURES.text).toBe(false);
    expect(assertTextEnabled).toThrow();
  });
  test("screen audio reaches only the selected viewer", () => {
    expect(shouldSubscribeMedia("screen_share_audio", "friend", null)).toBe(false);
    expect(shouldSubscribeMedia("screen_share_audio", "friend", "other")).toBe(false);
    expect(shouldSubscribeMedia("screen_share_audio", "friend", "friend")).toBe(true);
    expect(shouldPlayScreenAudio("friend", null, "default")).toBe(false);
    expect(shouldPlayScreenAudio("friend", "friend", "default")).toBe(true);
    expect(shouldPlayScreenAudio("friend", "friend", "none")).toBe(false);
  });
  test("mixed system audio is never retransmitted", () => {
    expect(safeScreenAudio("monitor")).toBe(false);
    expect(safeScreenAudio("window")).toBe(false);
    expect(safeScreenAudio(undefined)).toBe(false);
    expect(safeScreenAudio("browser")).toBe(true);
  });
});