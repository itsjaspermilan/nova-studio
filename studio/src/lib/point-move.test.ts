import { describe, expect, it } from "vitest";
import { centreOf, constrain, describeLock, describeMove, facingAxis, freePlane, lockForKey } from "./point-move";

describe("moving points predictably", () => {
  it("a free drag moves on the grid plane the camera faces most, never a slanted one", () => {
    expect(freePlane([0.2, -0.9, 0.3])).toBe("xz"); // from above: the floor
    expect(freePlane([0.1, -0.3, -0.95])).toBe("xy"); // from the front: the front wall
    expect(freePlane([-0.9, -0.3, 0.2])).toBe("yz"); // from the side: the side wall
    expect(facingAxis([0.6, -0.6, 0.5])).toBe(1); // a three-quarter view a little from above still counts as the floor
  });

  it("X, Y and Z lock to an axis, Shift with them to the plane across it, and the same key again lets go", () => {
    expect(lockForKey("y", false, null)).toBe("y");
    expect(lockForKey("Y", true, null)).toBe("xz");
    expect(lockForKey("y", false, "y")).toBeNull();
    expect(lockForKey("x", false, "y")).toBe("x");
    expect(lockForKey("q", false, "y")).toBeUndefined();
  });

  it("a movement keeps to its lock and snaps each axis on its own", () => {
    expect(constrain([1.4, 2.6, -0.4], "y", 1)).toEqual([0, 3, 0]);
    expect(constrain([1.4, 2.6, -0.6], "xz", 1)).toEqual([1, 0, -1]);
    expect(constrain([1.234, 2.6, 0], "xyz", null)).toEqual([1.23, 2.6, 0]);
    // from a point between grid lines, a snapped move lands it on the grid
    expect(constrain([1.4, 0, 0], "x", 1, [0.5, 0, 0])).toEqual([1.5, 0, 0]);
  });

  it("several points move by their middle, and the label says what changes", () => {
    expect(centreOf([[0, 0, 0], [4, 2, 0], [9, 9, 9]], [0, 1])).toEqual([2, 1, 0]);
    expect(describeMove([2, 4, 0], [0, 2, 0])).toBe("y 4 → 6 (+2)");
    expect(describeMove([2, 4, 0], [-1, 0, 0.5])).toBe("x 2 → 1 (-1)   z 0 → 0.5 (+0.5)");
    expect(describeMove([2, 4, 0], [0, 0, 0])).toBe("not moved");
    expect(describeLock("xz")).toBe("on the floor (x and z)");
  });
});
