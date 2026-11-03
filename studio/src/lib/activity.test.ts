import { describe, expect, it } from "vitest";
import { ACTIVITY_FILE, ago, parseActivity, toolWords } from "./activity";

const line = (o: object) => JSON.stringify(o);

describe("the activity log", () => {
  it("is read newest first, and bad or cut-off lines are skipped", () => {
    const text = [
      line({ t: 1000, tool: "model_write", files: ["models/a.glb"], note: "one" }),
      "{ cut off",
      line({ t: 2000, tool: "check", files: [], note: "no errors" }),
      line({ t: "soon", tool: "check" }),
      line({ t: 3000, tool: "scene_write", files: ["scenes/x.scene.json", 7], note: "bad", error: true }),
      "",
    ].join("\n");
    const list = parseActivity(text);
    expect(list.map((a) => a.t)).toEqual([3000, 2000, 1000]);
    expect(list[0]).toEqual({ t: 3000, tool: "scene_write", files: ["scenes/x.scene.json"], note: "bad", error: true });
    expect(list[1]!.error).toBeUndefined();
    expect(parseActivity(text, 2)).toHaveLength(2);
    expect(parseActivity(null)).toEqual([]);
    expect(ACTIVITY_FILE).toBe(".nova/activity.jsonl");
  });

  it("says how long ago in words", () => {
    const now = 1_000_000_000;
    expect(ago(now - 1000, now)).toBe("just now");
    expect(ago(now - 12_000, now)).toBe("12 s ago");
    expect(ago(now - 3 * 60_000, now)).toBe("3 min ago");
    expect(ago(now - 2 * 3_600_000, now)).toBe("2 h ago");
    expect(ago(now - 86_400_000, now)).toBe("1 day ago");
    expect(ago(now - 4 * 86_400_000, now)).toBe("4 days ago");
    expect(ago(now + 5000, now)).toBe("just now");
  });

  it("names tools in words, and unknown ones plainly", () => {
    expect(toolWords("model_write")).toBe("wrote a model");
    expect(toolWords("some_new_tool")).toBe("some new tool");
  });
});
