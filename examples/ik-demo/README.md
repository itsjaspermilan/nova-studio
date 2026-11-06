# IK Demo

A limb of three parts (`upper`, `lower`, `hand`, made in the model editor's format) hangs from a shoulder, and `nova.ik` puts its end on
a small target that circles it. The elbow bends toward a pole in front. The target is green while the limb can reach it and red when it
cannot (the limb then stretches toward it). See `docs/project-format.md`, "Joints and inverse kinematics".

    nova run examples/ik-demo
