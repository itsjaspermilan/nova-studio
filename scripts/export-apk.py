#!/usr/bin/python3
"""Local native APK exports. Never accepts passwords or creates signing keys."""

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
HISTORY = ROOT / "build/exports/version-history.json"


def fail(message):
    raise ValueError(message)


def run(arguments, capture=False):
    return subprocess.run([str(arg) for arg in arguments], check=True,
                          text=True, stdout=subprocess.PIPE if capture else None).stdout


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            fail("Duplicate JSON field: " + key)
        result[key] = value
    return result


def read_json(path):
    if path.stat().st_size > 128 * 1024:
        fail("JSON file exceeds 128 KiB: " + str(path))
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def relative_path(value):
    return (isinstance(value, str) and 0 < len(value) < 512 and
            all(32 <= ord(c) <= 126 and c not in "\\:#" for c in value) and
            all(part not in ("", ".", "..") for part in value.split("/")))


def contained_file(root, relative):
    if not relative_path(relative):
        fail("Invalid project-relative path: " + str(relative))
    path = (root / relative).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        fail("File escapes project root or is not regular: " + relative)
    if path.stat().st_size > 16 * 1024 * 1024:
        fail("File exceeds 16 MiB: " + relative)
    return path


def validate_config(config):
    fields = {"format", "version", "applicationId", "displayName", "versionCode",
              "versionName", "provenance"}
    if not isinstance(config, dict) or set(config) != fields:
        fail("Export config requires exactly: " + ", ".join(sorted(fields)))
    if config["format"] != "nova-export" or type(config["version"]) is not int or config["version"] != 1:
        fail("Unsupported export config; expected nova-export version 1")
    app = config["applicationId"]
    if (not isinstance(app, str) or len(app) > 150 or
            not re.fullmatch(r"[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+", app) or
            app == "studio.nova.runtime"):
        fail("Use a stable dotted lowercase applicationId distinct from studio.nova.runtime")
    for field, maximum in (("displayName", 64), ("versionName", 64)):
        value = config[field]
        if (not isinstance(value, str) or len(value) > maximum or
                not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._-]*", value) or value.endswith(" ")):
            fail(field + " must be 1..64 ASCII letters/digits/spaces/dots/underscores/hyphens")
    if type(config["versionCode"]) is not int or not 1 <= config["versionCode"] <= 2100000000:
        fail("versionCode must be an integer in 1..2100000000")
    notices = config["provenance"]
    if (not isinstance(notices, list) or not 1 <= len(notices) <= 32 or
            any(not relative_path(p) for p in notices) or len(set(notices)) != len(notices)):
        fail("provenance must contain 1..32 unique project-relative notice/license paths")
    return config


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def files_under(root):
    return {p.relative_to(root).as_posix(): p for p in sorted(root.rglob("*")) if p.is_file()}


def sdk_tool(name):
    sdk = os.environ.get("ANDROID_HOME")
    if not sdk:
        fail("ANDROID_HOME is unset; use scripts/export-apk.sh")
    tool = Path(sdk) / "build-tools/35.0.0" / name
    if not tool.is_file():
        fail("Missing existing Android tool: " + str(tool))
    return tool


def inspect_project(manifest):
    build = ROOT / "build/export-validator"
    run([ROOT / "scripts/with-toolchain.sh", "cmake", "-S", ROOT, "-B", build,
         "-DCMAKE_BUILD_TYPE=Debug", "-DBUILD_TESTING=OFF"])
    run([ROOT / "scripts/with-toolchain.sh", "cmake", "--build", build,
         "--target", "nova_export_validate", "-j", "4"])
    with tempfile.TemporaryDirectory(prefix="nova-export-list-") as temporary:
        listing = Path(temporary) / "files.txt"
        run([build / "nova_export_validate", manifest, "--files", listing], capture=True)
        paths = listing.read_text(encoding="ascii").splitlines()
    if not paths or any(not relative_path(p) for p in paths):
        fail("Native validator returned an invalid required-file listing")
    return paths, build / "dependency-notices"


def load_stage(directory):
    directory = directory.resolve(strict=True)
    stage = read_json(directory / "export.json")
    if (not isinstance(stage, dict) or set(stage) != {"format", "version", "config", "files"} or
            stage["format"] != "nova-export-stage" or
            type(stage["version"]) is not int or stage["version"] != 1):
        fail("Unsupported export stage")
    validate_config(stage["config"])
    actual = files_under(directory / "assets")
    if any(path.is_symlink() for path in (directory / "assets").rglob("*")):
        fail("Export stage contains a symlink; create a new stage")
    expected = stage["files"]
    if not isinstance(expected, dict) or set(actual) != set(expected):
        fail("Export stage file inventory changed; create a new stage")
    for name, path in actual.items():
        if path.is_symlink() or not path.resolve().is_relative_to(directory):
            fail("Export stage contains a symlink/escape: " + name)
        if digest(path) != expected[name]:
            fail("Export stage bytes changed: " + name)
    if "game/nova.project" not in expected or "licenses/LICENSE" not in expected:
        fail("Export stage is missing its project or Nova license")
    return stage


def check_previous(config, previous):
    if previous is None:
        return
    old = load_stage(previous)["config"]
    if old["applicationId"] != config["applicationId"]:
        fail("Previous export has a different applicationId")
    if config["versionCode"] <= old["versionCode"]:
        fail("An update requires a versionCode greater than the previous export")


def stage_project(args):
    config = validate_config(read_json(args.config))
    check_previous(config, args.previous_export)
    manifest = args.project.resolve(strict=True)
    if not manifest.is_file():
        fail("Project manifest is not a regular file")
    project = manifest.parent
    destination = args.output.resolve()
    if destination.exists() or destination.is_relative_to(project):
        fail("Export output must be new and outside the selected project root")
    paths, notices = inspect_project(manifest)
    required = {path: contained_file(project, path) for path in paths + config["provenance"]}
    if "nova.project" in required:
        fail("Reserved staged manifest path collides with a project file")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".nova-stage-", dir=destination.parent) as temporary:
        candidate = Path(temporary) / "export"
        game = candidate / "assets/game"
        game.mkdir(parents=True)
        shutil.copyfile(manifest, game / "nova.project")
        for relative, source in required.items():
            target = game / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        shutil.copytree(notices, candidate / "assets/licenses")
        sdk_tool("aapt2")
        glue = Path(os.environ["ANDROID_HOME"]) / "ndk/27.2.12479018/sources/android/native_app_glue"
        target = candidate / "assets/licenses/android-native-app-glue"
        target.mkdir()
        for name in ("android_native_app_glue.c", "android_native_app_glue.h"):
            shutil.copyfile(glue / name, target / name)
        # Validate copied bytes, not just their mutable source paths.
        run([ROOT / "build/export-validator/nova_export_validate", game / "nova.project"], capture=True)
        files = {name: digest(path) for name, path in files_under(candidate / "assets").items()}
        write_json(candidate / "export.json",
                   {"format": "nova-export-stage", "version": 1, "config": config, "files": files})
        candidate.rename(destination)
    print("Staged one native game: " + str(destination))


def certificate(value):
    normalized = value.replace(":", "").lower()
    if not re.fullmatch("[0-9a-f]{64}", normalized):
        fail("Certificate SHA-256 must contain exactly 64 hexadecimal digits")
    return normalized


def verify_signature(apk, expected=None, release=False):
    output = run([sdk_tool("apksigner"), "verify", "--verbose", "--print-certs", apk], capture=True)
    if "Verified using v2 scheme (APK Signature Scheme v2): true" not in output:
        fail("APK must have a verified v2 signature")
    hashes = re.findall(r"Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)", output)
    if len(hashes) != 1:
        fail("Expected exactly one APK signing certificate")
    if release and re.search(r"certificate DN:.*(?:CN=Android Debug|O=Android)", output, re.I):
        fail("A personal release must not use an Android debug certificate")
    if expected is not None and hashes[0].lower() != certificate(expected):
        fail("APK certificate does not match the pinned release certificate")
    return hashes[0].lower()


def verify_manifest(xml, release):
    stack = []
    roots = []
    for line in xml.splitlines():
        element = re.match(r"(\s*)E: ([\w-]+)\b", line)
        if element:
            depth = len(element[1])
            node = {"name": element[2], "attributes": {}, "children": []}
            while stack and stack[-1][0] >= depth:
                stack.pop()
            (stack[-1][1]["children"] if stack else roots).append(node)
            stack.append((depth, node))
        attribute = re.match(r"\s*A: (?:http://schemas.android.com/apk/res/android:)?"
                             r"(\w+)(?:\([^)]*\))?=(.*)", line)
        if attribute and stack:
            value = attribute[2]
            if value.startswith('"'):
                value = json.JSONDecoder().raw_decode(value)[0]
            attributes = stack[-1][1]["attributes"]
            if attribute[1] in attributes:
                fail("Duplicate compiled manifest attribute")
            attributes[attribute[1]] = value

    def children(node, names):
        actual = [child["name"] for child in node["children"]]
        if sorted(actual) != sorted(names):
            fail("Unexpected Android manifest elements under " + node["name"])
        return {child["name"]: child for child in node["children"]}

    def attributes(node, values):
        if any(node["attributes"].get(name) != value for name, value in values.items()):
            fail("Unexpected Android manifest attributes on " + node["name"])

    if len(roots) != 1 or roots[0]["name"] != "manifest":
        fail("Expected one compiled Android manifest")
    top = children(roots[0], ["uses-sdk", "uses-feature", "application"])
    attributes(top["uses-sdk"], {"minSdkVersion": "26", "targetSdkVersion": "33"})
    attributes(top["uses-feature"], {"glEsVersion": "0x00020000", "required": "true"})
    app = top["application"]
    attributes(app, {"hasCode": "false", "allowBackup": "false"})
    if release and app["attributes"].get("debuggable", "false") != "false":
        fail("Standalone release APK must not be debuggable")
    activity = children(app, ["activity"])["activity"]
    attributes(activity, {"name": "android.app.NativeActivity", "exported": "true",
                          "screenOrientation": "0", "configChanges": "0x000004a0"})
    activity_children = children(activity, ["meta-data", "intent-filter"])
    attributes(activity_children["meta-data"], {"name": "android.app.lib_name", "value": "nova_runtime"})
    intent = children(activity_children["intent-filter"], ["action", "category"])
    attributes(intent["action"], {"name": "android.intent.action.MAIN"})
    attributes(intent["category"], {"name": "android.intent.category.LAUNCHER"})
    for node in (top["uses-sdk"], top["uses-feature"], activity_children["meta-data"],
                 intent["action"], intent["category"]):
        children(node, [])


def verify_apk(apk, directory=None, expected_certificate=None, unsigned=False):
    stage = load_stage(directory) if directory else None
    if expected_certificate and not stage:
        fail("Release verification requires --export")
    if stage:
        expected_files = files_under(directory.resolve() / "assets")
    else:
        expected_files = {"examples/" + name: path for name, path in files_under(ROOT / "examples").items()}
        notices = ROOT / "android/app/build/generated/novaAssets/licenses"
        if not (notices / "LICENSE").is_file():
            fail("Build the sample APK first; generated notices are missing")
        expected_files.update({"licenses/" + name: path for name, path in files_under(notices).items()})
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            fail("APK contains duplicate ZIP entries")
        assets = {name[7:] for name in names if name.startswith("assets/") and not name.endswith("/")}
        if assets != set(expected_files):
            fail("APK asset inventory differs from the selected game/notices")
        for name, path in expected_files.items():
            if archive.read("assets/" + name) != path.read_bytes():
                fail("APK file differs from expected bytes: " + name)
        libraries = {name for name in names if name.startswith("lib/") and not name.endswith("/")}
        if libraries != {"lib/arm64-v8a/libnova_runtime.so"}:
            fail("APK must contain only the arm64-v8a Nova runtime")
        with tempfile.TemporaryDirectory(prefix="nova-apk-verify-") as temporary:
            native = Path(temporary) / "runtime.so"
            native.write_bytes(archive.read("lib/arm64-v8a/libnova_runtime.so"))
            host = {"darwin": "darwin-x86_64", "linux": "linux-x86_64"}.get(sys.platform)
            if host is None:
                fail("APK verification supports macOS and Linux")
            llvm = Path(os.environ["ANDROID_HOME"]) / "ndk/27.2.12479018/toolchains/llvm/prebuilt" / host / "bin"
            if not re.search(r"Machine:\s+AArch64", run([llvm / "llvm-readelf", "-h", native], capture=True)):
                fail("APK runtime is not AArch64")
            symbols = run([llvm / "llvm-nm", "-D", "--defined-only", native], capture=True)
            for symbol in ("ANativeActivity_onCreate", "android_main", "nova_tick"):
                if not re.search(r"\s" + symbol + r"$", symbols, re.M):
                    fail("APK lacks required exported symbol: " + symbol)
            if stage and not re.search(r"\snova_standalone_project$", symbols, re.M):
                fail("APK runtime was not compiled for standalone game startup")
    badging = run([sdk_tool("aapt2"), "dump", "badging", apk], capture=True)
    xml = run([sdk_tool("aapt2"), "dump", "xmltree", "--file", "AndroidManifest.xml", apk], capture=True)
    verify_manifest(xml, release=stage is not None)
    config = stage["config"] if stage else {"applicationId": "studio.nova.runtime",
                                          "versionCode": 1, "versionName": "0.1.0",
                                          "displayName": "Nova Studio"}
    package = re.search(r"^package: name='([^']*)' versionCode='([^']*)' versionName='([^']*)'", badging, re.M)
    if not package or package.groups() != (config["applicationId"], str(config["versionCode"]), config["versionName"]):
        fail("APK applicationId/version metadata differs from the requested identity")
    if "application-label:'" + config["displayName"] + "'" not in badging:
        fail("APK display name differs from the requested identity")
    if "minSdkVersion:'26'" not in badging or "targetSdkVersion:'33'" not in badging:
        fail("APK SDK levels differ from the pinned native runtime contract")
    if not unsigned:
        if stage and expected_certificate is None:
            fail("Signed release verification requires --certificate-sha256")
        verify_signature(apk, expected_certificate, release=stage is not None)
    print("APK verified: exact assets/notices, ARM64 exports, native activity and " +
          ("unsigned release structure." if unsigned else "identity/signature."))


@contextlib.contextmanager
def history_lock():
    HISTORY.parent.mkdir(parents=True, exist_ok=True)
    with (HISTORY.parent / ".export.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        history = read_json(HISTORY) if HISTORY.exists() else {}
        if not isinstance(history, dict):
            fail("Invalid local export version history")
        for record in history.values():
            if (not isinstance(record, dict) or
                    set(record) != {"versionCode", "stageSha256", "apkSha256", "certificateSha256"} or
                    type(record["versionCode"]) is not int or
                    not 1 <= record["versionCode"] <= 2100000000 or
                    any(not isinstance(record[key], str) or not re.fullmatch("[0-9a-f]{64}", record[key])
                        for key in ("stageSha256", "apkSha256")) or
                    (record["certificateSha256"] is not None and
                     (not isinstance(record["certificateSha256"], str) or
                      not re.fullmatch("[0-9a-f]{64}", record["certificateSha256"])))):
                fail("Invalid local export version history; retain your version/certificate records")
        yield history
        with tempfile.NamedTemporaryFile(mode="w", dir=HISTORY.parent, delete=False) as temporary:
            json.dump(history, temporary, indent=2, sort_keys=True)
            temporary.write("\n")
        Path(temporary.name).replace(HISTORY)


def build_export(args):
    directory = args.export.resolve(strict=True)
    stage = load_stage(directory)
    check_previous(stage["config"], args.previous_export)
    app = stage["config"]["applicationId"]
    code = stage["config"]["versionCode"]
    stage_hash = digest(directory / "export.json")
    with history_lock() as history:
        previous = history.get(app)
        if previous and (code < previous["versionCode"] or
                         (code == previous["versionCode"] and stage_hash != previous["stageSha256"])):
            fail("versionCode must increase for changed exports (local version history)")
        run([ROOT / "scripts/android-doctor.sh"])
        run([ROOT / "android/gradlew", "-p", ROOT / "android",
             "-PnovaExportDirectory=" + str(directory), ":app:assembleRelease"])
        apk = directory / "android-build/outputs/apk/release/app-release-unsigned.apk"
        verify_apk(apk, directory, unsigned=True)
        load_stage(directory)
        if digest(directory / "export.json") != stage_hash:
            fail("Export configuration changed during the build")
        apk_hash = digest(apk)
        if previous and code == previous["versionCode"] and apk_hash != previous["apkSha256"]:
            fail("Built APK changed; increment versionCode and create a new export")
        history[app] = {"versionCode": code, "stageSha256": stage_hash,
                        "apkSha256": apk_hash,
                        "certificateSha256": previous.get("certificateSha256") if previous else None}
    print("Unsigned native release APK: " + str(apk))


def sign_export(args):
    directory = args.export.resolve(strict=True)
    stage = load_stage(directory)
    expected = certificate(args.certificate_sha256)
    keystore = args.keystore.resolve(strict=True)
    if (not keystore.is_file() or keystore.is_relative_to(ROOT) or
            keystore.is_relative_to(directory) or
            any((parent / ".git").exists() for parent in keystore.parents)):
        fail("Keystore must be a regular file outside all Git repositories and export directories")
    if not sys.stdin.isatty():
        fail("Signing requires a local interactive terminal; no password arguments/files are supported")
    apk = directory / "android-build/outputs/apk/release/app-release-unsigned.apk"
    verify_apk(apk, directory, unsigned=True)
    config = stage["config"]
    output = directory / (config["applicationId"] + "-" + str(config["versionCode"]) + "-release.apk")
    if output.exists():
        fail("Signed output already exists; refusing to overwrite it")
    with history_lock() as history:
        previous = history.get(config["applicationId"])
        if (not previous or previous["versionCode"] != config["versionCode"] or
                previous["stageSha256"] != digest(directory / "export.json") or
                previous["apkSha256"] != digest(apk)):
            fail("Build this exact export successfully before signing (local version history)")
        if previous and previous.get("certificateSha256") not in (None, expected):
            fail("Certificate differs from prior personal releases in local history")
        with tempfile.TemporaryDirectory(prefix=".nova-sign-", dir=directory) as temporary:
            aligned = Path(temporary) / "aligned.apk"
            signed = Path(temporary) / "signed.apk"
            run([sdk_tool("zipalign"), "-f", "-P", "16", "4", apk, aligned])
            # apksigner owns its hidden terminal prompts; no passwords enter this process.
            run([sdk_tool("apksigner"), "sign", "--ks", keystore, "--ks-key-alias", args.alias,
                 "--min-sdk-version", "26", "--v2-signing-enabled", "true", "--out", signed, aligned])
            verify_apk(signed, directory, expected)
            run([sdk_tool("zipalign"), "-c", "-P", "16", "4", signed])
            signed.rename(output)
        previous["certificateSha256"] = expected
    print("Personal non-debug release APK: " + str(output))


def main():
    if sys.version_info < (3, 9):
        print("Nova APK export: requires /usr/bin/python3 version 3.9 or newer", file=sys.stderr)
        return 1
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    stage = commands.add_parser("stage", help="Validate and copy one game's declared files and provenance")
    stage.add_argument("--project", required=True, type=Path)
    stage.add_argument("--config", required=True, type=Path)
    stage.add_argument("--output", required=True, type=Path)
    stage.add_argument("--previous-export", type=Path)
    stage.set_defaults(action=stage_project)
    build = commands.add_parser("build", help="Build and structurally verify an unsigned native release")
    build.add_argument("--export", required=True, type=Path)
    build.add_argument("--previous-export", type=Path)
    build.set_defaults(action=build_export)
    sign = commands.add_parser("sign", help="Sign interactively with an existing external personal keystore")
    sign.add_argument("--export", required=True, type=Path)
    sign.add_argument("--keystore", required=True, type=Path)
    sign.add_argument("--alias", required=True)
    sign.add_argument("--certificate-sha256", required=True)
    sign.set_defaults(action=sign_export)
    verify = commands.add_parser("verify", help="Verify sample debug APK or a pinned personal release")
    verify.add_argument("--apk", type=Path, default=ROOT / "android/app/build/outputs/apk/debug/app-debug.apk")
    verify.add_argument("--export", type=Path)
    verify.add_argument("--certificate-sha256")
    verify.add_argument("--unsigned", action="store_true")
    verify.set_defaults(action=lambda args: verify_apk(args.apk, args.export, args.certificate_sha256, args.unsigned))
    args = parser.parse_args()
    if args.command == "verify" and args.unsigned and not args.export:
        parser.error("--unsigned is only valid with --export")
    try:
        args.action(args)
    except (ValueError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print("Nova APK export: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
