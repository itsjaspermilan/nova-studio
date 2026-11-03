"""Collects the licences of the Rust crates a Nova build is made of.

  scripts/third-party.sh           writes licences/rust-dependencies.txt (the notices shipped with exported games)
  scripts/third-party.sh --check   also fails if a crate's licence is not on the allow-list

Reads `cargo metadata` JSON on stdin. Crates with identical licence text are listed together under one copy of it.
"""
import json
import os
import re
import sys

ALLOWED = {
    "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Unicode-3.0", "Unicode-DFS-2016",
    "MPL-2.0", "CC0-1.0", "0BSD", "BSL-1.0", "Unlicense", "OFL-1.1", "LLVM-exception", "Apache-2.0 WITH LLVM-exception",
}
LICENSE_FILE = re.compile(r"^(LICEN[CS]E|COPYING|UNLICENSE|NOTICE)", re.I)


def allowed(expr):
    """True if the SPDX expression can be satisfied with allowed licences (OR picks one, AND needs all)."""
    tokens = re.findall(r"\(|\)|[A-Za-z0-9.+\-]+", expr.replace("/", " OR "))
    pos = 0

    def parse_or():
        nonlocal pos
        value = parse_and()
        while pos < len(tokens) and tokens[pos].upper() == "OR":
            pos += 1
            other = parse_and()
            value = value or other
        return value

    def parse_and():
        nonlocal pos
        value = parse_atom()
        while pos < len(tokens) and tokens[pos].upper() == "AND":
            pos += 1
            other = parse_atom()
            value = value and other
        return value

    def parse_atom():
        nonlocal pos
        if pos >= len(tokens):
            return False
        t = tokens[pos]
        pos += 1
        if t == "(":
            value = parse_or()
            if pos < len(tokens) and tokens[pos] == ")":
                pos += 1
            return value
        ok = t.rstrip("+") in ALLOWED
        if pos < len(tokens) and tokens[pos].upper() == "WITH":  # an exception only widens the licence
            pos += 2
        return ok

    return parse_or()


def main():
    check = "--check" in sys.argv
    meta = json.load(sys.stdin)
    members = set(meta["workspace_members"])
    by_id = {p["id"]: p for p in meta["packages"]}
    # only what the runtime library and program are built from
    runtime = next(p["id"] for p in meta["packages"] if p["name"] == "nova-runtime")
    nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
    seen, stack = set(), [runtime]
    while stack:
        i = stack.pop()
        if i in seen:
            continue
        seen.add(i)
        stack.extend(d["pkg"] for d in nodes[i]["deps"] if any(k.get("kind") in (None, "build") for k in d["dep_kinds"]))
    crates = sorted((by_id[i] for i in seen if i not in members), key=lambda p: (p["name"], p["version"]))
    bad = [f"{p['name']} {p['version']}: {p.get('license') or p.get('license_file') or 'no licence'}" for p in crates if not allowed(p.get("license") or "")]
    groups = {}
    for p in crates:
        folder = os.path.dirname(p["manifest_path"])
        texts = []
        for name in sorted(os.listdir(folder)):
            if LICENSE_FILE.match(name) and os.path.isfile(os.path.join(folder, name)):
                texts.append(open(os.path.join(folder, name), encoding="utf-8", errors="replace").read().strip())
        body = "\n\n".join(texts) if texts else f"(no licence file shipped with the crate; declared licence: {p.get('license')})"
        groups.setdefault(body, []).append(f"{p['name']} {p['version']} ({p.get('license') or 'see text'})")
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = ["Third-party software in this game's runtime", "=" * 44, "",
           f"{len(crates)} Rust crates, grouped by the licence text they ship with.", ""]
    for body, names in sorted(groups.items(), key=lambda kv: kv[1][0]):
        out += ["-" * 72, "Used by: " + ", ".join(names), "-" * 72, body, ""]
    extra = [os.path.join(root, "licenses", "lua.txt")] + sorted(
        os.path.join(root, "licenses", "fonts", f) for f in os.listdir(os.path.join(root, "licenses", "fonts")) if os.path.isfile(os.path.join(root, "licenses", "fonts", f)))
    for path in extra:
        out += ["-" * 72, f"Bundled: {os.path.relpath(path, root)}", "-" * 72, open(path, encoding="utf-8", errors="replace").read().strip(), ""]
    dest = os.path.join(root, "licenses", "rust-dependencies.txt")
    open(dest, "w", encoding="utf-8").write("\n".join(out))
    print(f"{len(crates)} crates, {len(groups)} distinct licence texts -> {os.path.relpath(dest, root)}", file=sys.stderr)
    if bad:
        print("licences not on the allow-list:\n  " + "\n  ".join(bad), file=sys.stderr)
        if check:
            sys.exit(1)


main()
