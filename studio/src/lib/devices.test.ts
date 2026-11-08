// Play on device: the words about devices, the mock backend's device run and the store's flow.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceHint, preferredDevice } from "./devices";
import { createMockApi } from "./mock";
import { studio } from "./store.svelte";
import type { AndroidDevice } from "./types";

const retroid: AndroidDevice = { serial: "bc8565a3", state: "device", name: "Retroid Pocket 6", emulator: false };
const emulator: AndroidDevice = { serial: "emulator-5554", state: "device", name: "retroid-sim (emulator)", emulator: true };
const locked: AndroidDevice = { serial: "R58N", state: "unauthorized", name: "R58N", emulator: false };

describe("device words", () => {
  it("says what to do with a device that is not ready", () => {
    expect(deviceHint(retroid)).toBeNull();
    expect(deviceHint(locked)).toMatch(/Allow USB debugging/);
    expect(deviceHint({ ...retroid, state: "offline" })).toMatch(/plug it back in/);
    expect(deviceHint({ ...retroid, state: "no permissions (user in plugdev group)" })).toMatch(/not allowed/);
  });

  it("offers the device used last, else a handheld before an emulator", () => {
    expect(preferredDevice([emulator, retroid], null)).toBe(retroid);
    expect(preferredDevice([emulator, retroid], "emulator-5554")).toBe(emulator);
    expect(preferredDevice([locked, emulator], "R58N")).toBe(emulator);
    expect(preferredDevice([locked], null)).toBeNull();
  });
});

describe("mock backend", () => {
  it("builds, installs and starts with steps, and Stop ends it", async () => {
    vi.useFakeTimers();
    const api = createMockApi({ devices: [retroid, locked] });
    await api.newProject("/mock", "Demo", "starter");
    const steps: string[] = [];
    const lines: string[] = [];
    const exits: (number | null)[] = [];
    await api.onDeviceStep((s) => steps.push(s));
    await api.onPlayLog((l) => lines.push(l.line));
    await api.onPlayExit((c) => exits.push(c));
    await expect(api.playOnDevice("R58N")).rejects.toMatch(/has not allowed this computer/);
    await expect(api.playOnDevice("nope")).rejects.toMatch(/not connected any more/);
    expect(await api.playOnDevice("bc8565a3")).toBe("com.nova.games.demo");
    expect(steps[0]).toBe("Building the game for Android");
    expect(steps.at(-1)).toBe("Starting the game on Retroid Pocket 6");
    expect(await api.isRunning()).toBe(true);
    await expect(api.runProject()).rejects.toMatch(/already running/);
    vi.advanceTimersByTime(1100);
    expect(lines.some((l) => l.includes("on bc8565a3"))).toBe(true);
    expect(await api.stopProject()).toBe(true);
    expect(exits).toEqual([null]);
    vi.useRealTimers();
  });

  it("with no device says how to connect one", async () => {
    const api = createMockApi({ devices: [] });
    await api.newProject("/mock", "Demo", "starter");
    expect(await api.listDevices()).toEqual([]);
    await expect(api.playOnDevice("bc8565a3")).rejects.toMatch(/No device is connected/);
  });
});

describe("the studio", () => {
  beforeEach(async () => {
    vi.stubGlobal("confirm", () => true);
    studio.api = createMockApi({ devices: [retroid, locked] });
    await studio.newProject("/mock", "T", "starter");
    studio.notice = null;
  });
  afterEach(async () => {
    await studio.stop();
  });

  it("plays on a device and shows where in the Play panel, and Stop stops it", async () => {
    await studio.findDevices();
    expect(studio.devices.map((d) => d.serial)).toEqual(["bc8565a3", "R58N"]);
    expect(studio.devicesProblem).toBeNull();
    await studio.playOnDevice(studio.devices[0]!);
    expect(studio.running).toBe(true);
    expect(studio.playingOn?.name).toBe("Retroid Pocket 6");
    expect(studio.deviceStep).toBeNull();
    expect(studio.panel).toBe("play");
    expect(studio.log.some((l) => l.line === "— running on Retroid Pocket 6 —")).toBe(true);
    await studio.stop();
    expect(studio.running).toBe(false);
    expect(studio.playingOn).toBeNull();
  });

  it("says in plain words why it could not, and is ready to try again", async () => {
    await studio.playOnDevice(locked);
    expect(studio.running).toBe(false);
    expect(studio.notice?.kind).toBe("error");
    expect(studio.notice?.text).toMatch(/Allow USB debugging/);
    expect(studio.log.at(-1)?.stream).toBe("stderr");
  });

  it("does not put a game with errors on the device", async () => {
    await studio.api!.writeFile("main.lua", "TODO_BREAK\n");
    await studio.playOnDevice(retroid);
    expect(studio.running).toBe(false);
    expect(studio.notice?.text).toMatch(/Problems/);
  });

  it("explains a missing adb or an empty list", async () => {
    studio.api = { ...createMockApi({ devices: [] }), listDevices: () => Promise.reject("The Android tools (adb) are not on this computer.") };
    await studio.findDevices();
    expect(studio.devicesProblem).toMatch(/adb/);
    studio.api = createMockApi({ devices: [] });
    await studio.findDevices();
    expect(studio.devicesProblem).toMatch(/No device is connected/);
    await studio.playOnPreferredDevice();
    expect(studio.notice?.text).toMatch(/No device is connected/);
  });
});
