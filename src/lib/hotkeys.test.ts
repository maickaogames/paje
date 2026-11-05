import { describe, expect, it } from "vitest";
import { comboFromEvent, comboLabel, comboToAccelerator, matchesCombo, DEFAULT_HOTKEYS } from "./hotkeys";
import { isUpdateAvailable } from "./updater";

const ev = (code: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("hotkeys", () => {
  it("default keys are F8 webcam, F9 share, F10 PiP", () => {
    expect(DEFAULT_HOTKEYS).toEqual({ cam: "F8", share: "F9", pip: "F10" });
  });
  it("records modifiers with the key", () => {
    expect(comboFromEvent(ev("KeyP", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+KeyP");
  });
  it("ignores a modifier pressed alone", () => {
    expect(comboFromEvent(ev("ShiftLeft", { shiftKey: true }))).toBeNull();
  });
  it("does not match when modifiers differ", () => {
    expect(matchesCombo(ev("F9", { ctrlKey: true }), "F9")).toBe(false);
    expect(matchesCombo(ev("F9"), "F9")).toBe(true);
  });
  it("converts to Windows global shortcut format", () => {
    expect(comboToAccelerator("Ctrl+Alt+KeyW")).toBe("Control+Alt+KeyW");
    expect(comboLabel("Ctrl+Digit1")).toBe("Ctrl+1");
  });
});

describe("updater", () => {
  it("updates only when the published build is newer", () => {
    expect(isUpdateAvailable(5, 6)).toBe(true);
    expect(isUpdateAvailable(6, 6)).toBe(false);
    expect(isUpdateAvailable(7, 6)).toBe(false);
  });
});
