-- Nova Stress: a benchmark, not a game. It runs a list of scenes of growing weight (a city of Kenney's pieces, cars, animated
-- characters, point lights, shadows), reads what the engine measured with nova.perf(), and logs one line a phase:
--   bench: phase=<name> fps=.. p95=.. max=.. lua=.. render=.. draws=.. tris=.. culled=..
-- then a verdict line. Run it headless on the desktop, in the emulator or on the device (scripts/bench.sh), and read the log.
nova.start("bench")
