import { describe, expect, test } from "vitest";
import { MEDIA_FEATURES, MEDIA_PUBLISH_SOURCES, shouldSubscribeMedia, shouldPlayScreenAudio, safeScreenAudio, allowScreenAudio, assertTextEnabled } from "./media-policy";

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
  test("helper audio excludes Discord by construction and is allowed on any surface", () => {
    expect(allowScreenAudio("monitor", true)).toBe(true);
    expect(allowScreenAudio("window", true)).toBe(true);
    expect(allowScreenAudio("monitor", false)).toBe(false);
    expect(allowScreenAudio("window", false)).toBe(false);
    expect(allowScreenAudio("browser", false)).toBe(true);
  });
});
import { shareProfileParams } from "./media-policy";
describe("shareProfileParams", () => {
  it("padrão é desempenho 720p/30", () => {
    expect(shareProfileParams(undefined)).toMatchObject({ height: 720, fps: 30 });
  });
  it("qualidade é 1080p/60", () => {
    expect(shareProfileParams("quality")).toMatchObject({ height: 1080, fps: 60 });
  });
});
