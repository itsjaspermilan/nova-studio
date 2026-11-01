#!/usr/bin/python3
"""Isolated export/signing tests: no SDK, GPU, device, or real signing key."""

import argparse
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location("nova_export", Path(__file__).resolve().parents[1] / "scripts/export-apk.py")
export = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(export)
CERT = "ab" * 32
CONFIG = {"format": "nova-export", "version": 1, "applicationId": "studio.nova.games.test",
          "displayName": "Test Game", "versionCode": 1, "versionName": "0.1.0",
          "provenance": ["NOTICE.txt"]}
XML = """E: manifest
 E: uses-sdk
  A: minSdkVersion=26
  A: targetSdkVersion=33
 E: uses-feature
  A: glEsVersion=0x00020000
  A: required=true
 E: application
  A: http://schemas.android.com/apk/res/android:hasCode(0x0101000c)=false
  A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=false
  E: activity
   A: http://schemas.android.com/apk/res/android:exported(0x01010010)=true
   A: name="android.app.NativeActivity"
   A: screenOrientation=0
   A: configChanges=0x000004a0
   E: meta-data
    A: name="android.app.lib_name"
    A: value="nova_runtime"
   E: intent-filter
    E: action
     A: name="android.intent.action.MAIN"
    E: category
     A: name="android.intent.category.LAUNCHER"
"""
BADGING = """package: name='studio.nova.games.test' versionCode='1' versionName='0.1.0'
application-label:'Test Game'
minSdkVersion:'26'
targetSdkVersion:'33'
"""
SIGNATURE = ("Verified using v2 scheme (APK Signature Scheme v2): true\n"
             "Signer #1 certificate DN: CN=Personal Test\n"
             "Signer #1 certificate SHA-256 digest: " + CERT + "\n")


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="nova-export-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = self.root / "output"
        self.project = self.root / "project"
        self.project.mkdir()
        (self.project / "main.lua").write_text("function update() end\n")
        (self.project / "nova.project").write_text("nova-project 1\nentry main.lua\n")
        (self.project / "NOTICE.txt").write_text("Original test scene; MIT.\n")
        (self.project / "private.txt").write_text("Must not be shipped\n")
        self.config = self.root / "config.json"
        export.write_json(self.config, CONFIG)
        self.notices = self.root / "notices"
        self.notices.mkdir()
        (self.notices / "LICENSE").write_text("MIT test notice\n")
        self.sdk = self.root / "sdk"
        glue = self.sdk / "ndk/27.2.12479018/sources/android/native_app_glue"
        glue.mkdir(parents=True)
        for name in ("android_native_app_glue.c", "android_native_app_glue.h"):
            (glue / name).write_text("Test native glue notice\n")
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {"ANDROID_HOME": str(self.sdk)}).start()
        patch.object(export, "HISTORY", self.root / "history/version-history.json").start()
        self.invocations = []
        patch.object(export, "sdk_tool", side_effect=lambda name: Path(name)).start()

    def make_stage(self, output=None, previous=None):
        args = argparse.Namespace(config=self.config, project=self.project / "nova.project",
                                  output=output or self.output, previous_export=previous)
        with patch.object(export, "inspect_project", return_value=(["main.lua"], self.notices)), \
                patch.object(export, "run", return_value="main.lua\n"), contextlib.redirect_stdout(io.StringIO()):
            export.stage_project(args)
        return args.output

    def make_apk(self, directory=None, extra=None, missing=None):
        directory = directory or self.output
        apk = directory / "android-build/outputs/apk/release/app-release-unsigned.apk"
        apk.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(apk, "w") as archive:
            for name, path in export.files_under(directory / "assets").items():
                if name != missing:
                    archive.writestr(zipfile.ZipInfo("assets/" + name), path.read_bytes())
            archive.writestr(zipfile.ZipInfo("lib/arm64-v8a/libnova_runtime.so"), b"fake native library")
            if extra:
                archive.writestr(extra, b"unexpected")
        return apk

    def fake_run(self, arguments, capture=False):
        arguments = [str(arg) for arg in arguments]
        self.invocations.append(arguments)
        name = Path(arguments[0]).name
        if name == "llvm-readelf":
            return "Machine: AArch64\n"
        if name == "llvm-nm":
            return "T ANativeActivity_onCreate\nT android_main\nT nova_tick\nR nova_standalone_project\n"
        if name == "aapt2":
            return BADGING if "badging" in arguments else XML
        if name == "apksigner":
            if "sign" in arguments:
                shutil.copyfile(arguments[-1], arguments[arguments.index("--out") + 1])
                return None
            return SIGNATURE
        if name == "zipalign":
            if "-c" not in arguments:
                shutil.copyfile(arguments[-2], arguments[-1])
            return None
        if name == "gradlew":
            self.make_apk(Path(arguments[-2].split("=", 1)[1]))
        return ""

    def test_config_strict_types_and_unknown_fields(self):
        changes = {"format": "other", "version": True, "versionCode": True,
                   "applicationId": "studio.nova.runtime", "displayName": "<XML>",
                   "versionName": "bad'name", "provenance": ["../secret"]}
        for field, value in changes.items():
            with self.subTest(field=field), self.assertRaises(ValueError):
                export.validate_config(dict(CONFIG, **{field: value}))
        with self.assertRaises(ValueError):
            export.validate_config(dict(CONFIG, password="must-not-be-accepted"))
        for code in (0, 2100000001, 1.0, "1"):
            with self.subTest(code=code), self.assertRaises(ValueError):
                export.validate_config(dict(CONFIG, versionCode=code))
        export.validate_config(dict(CONFIG, versionCode=2100000000))

    def test_duplicate_json_is_rejected(self):
        self.config.write_text('{"version":1,"version":2}')
        with self.assertRaisesRegex(ValueError, "Duplicate JSON"):
            export.read_json(self.config)

    def test_world_resolution_optional_default_and_bounded_values(self):
        export.validate_config(CONFIG)
        for value in ("960x540", "1280x720", "1920x1080"):
            export.validate_config(dict(CONFIG, worldResolution=value))
        for value in ("640x360", "1920x1200", "", None, 720, ["1280x720"]):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "worldResolution"):
                export.validate_config(dict(CONFIG, worldResolution=value))
        export.write_json(self.config, dict(CONFIG, worldResolution="1280x720"))
        self.make_stage()
        self.assertEqual(export.load_stage(self.output)["config"]["worldResolution"], "1280x720")

    def test_stage_copies_exact_required_files_and_notices(self):
        self.make_stage()
        stage = export.load_stage(self.output)
        self.assertEqual(set(stage["files"]), {"game/nova.project", "game/main.lua", "game/NOTICE.txt",
                         "licenses/LICENSE", "licenses/android-native-app-glue/android_native_app_glue.c",
                         "licenses/android-native-app-glue/android_native_app_glue.h"})
        self.assertNotIn("private.txt", str(stage))
        self.assertNotIn(str(self.project), (self.output / "export.json").read_text())
        with self.assertRaises(ValueError):
            self.make_stage()

    def test_stage_output_inside_project_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "outside"):
            self.make_stage(self.project / "output")

    def test_root_escape_and_nonregular_provenance_rejected(self):
        (self.root / "outside.txt").write_text("outside")
        (self.project / "NOTICE.txt").unlink()
        (self.project / "NOTICE.txt").symlink_to(self.root / "outside.txt")
        with self.assertRaisesRegex(ValueError, "escapes"):
            self.make_stage()
        (self.project / "NOTICE.txt").unlink()
        (self.project / "NOTICE.txt").mkdir()
        with self.assertRaisesRegex(ValueError, "regular"):
            self.make_stage()

    def test_native_failure_never_leaves_stage(self):
        with patch.object(export, "inspect_project", side_effect=ValueError("bad PNG")):
            with self.assertRaisesRegex(ValueError, "PNG"):
                export.stage_project(argparse.Namespace(config=self.config,
                    project=self.project / "nova.project", output=self.output, previous_export=None))
        self.assertFalse(self.output.exists())

    @unittest.skipUnless(os.environ.get("NOVA_EXPORT_VALIDATOR"), "Native validator supplied by CTest")
    def test_real_native_preflight_rejects_lua_and_paths(self):
        validator = os.environ["NOVA_EXPORT_VALIDATOR"]
        manifest = self.project / "nova.project"
        result = subprocess.run([validator, str(manifest)], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "main.lua\n")
        (self.project / "main.lua").write_text("print('unrelated-file')\nfunction update() print('hello') end\n")
        listing = self.root / "listing.txt"
        result = subprocess.run([validator, str(manifest), "--files", str(listing)], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("hello", result.stdout)
        self.assertEqual(listing.read_text(), "main.lua\n")
        for source in ("not valid Lua!", "function update() while true do end end",
                       "function update() nova.asset('missing') end"):
            (self.project / "main.lua").write_text(source)
            result = subprocess.run([validator, str(manifest)], text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Nova export validation:", result.stderr)
            self.assertEqual(result.stdout, "")
        manifest.write_text("nova-project 1\nentry ../main.lua\n")
        result = subprocess.run([validator, str(manifest)], text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)

    def test_changed_inventory_bytes_and_symlinks_rejected(self):
        self.make_stage()
        (self.output / "assets/game/main.lua").write_text("changed")
        with self.assertRaisesRegex(ValueError, "bytes changed"):
            export.load_stage(self.output)
        (self.output / "assets/game/main.lua").write_bytes((self.project / "main.lua").read_bytes())
        (self.output / "assets/extra").write_text("extra")
        with self.assertRaisesRegex(ValueError, "inventory"):
            export.load_stage(self.output)
        (self.output / "assets/extra").unlink()
        (self.output / "assets/game/main.lua").unlink()
        (self.output / "assets/game/main.lua").symlink_to(self.project / "main.lua")
        with self.assertRaisesRegex(ValueError, "symlink"):
            export.load_stage(self.output)

    def test_previous_export_requires_same_id_and_greater_code(self):
        self.make_stage()
        with self.assertRaisesRegex(ValueError, "greater"):
            self.make_stage(self.root / "second", self.output)
        export.write_json(self.config, dict(CONFIG, versionCode=2))
        self.make_stage(self.root / "second", self.output)
        export.write_json(self.config, dict(CONFIG, applicationId="studio.nova.games.other", versionCode=3))
        with self.assertRaisesRegex(ValueError, "different"):
            self.make_stage(self.root / "third", self.output)

    def test_verify_signed_release_and_missing_pin(self):
        self.make_stage()
        apk = self.make_apk()
        with patch.object(export, "run", side_effect=self.fake_run), contextlib.redirect_stdout(io.StringIO()):
            export.verify_apk(apk, self.output, CERT)
            with self.assertRaisesRegex(ValueError, "requires"):
                export.verify_apk(apk, self.output)
            with self.assertRaisesRegex(ValueError, "pinned"):
                export.verify_apk(apk, self.output, "cd" * 32)

    def test_verify_rejects_extra_or_missing_assets(self):
        self.make_stage()
        with patch.object(export, "run", side_effect=self.fake_run):
            for kwargs in ({"extra": "assets/examples/mixed/main.lua"}, {"missing": "game/NOTICE.txt"}):
                with self.subTest(kwargs=kwargs), self.assertRaisesRegex(ValueError, "inventory"):
                    export.verify_apk(self.make_apk(**kwargs), self.output, unsigned=True)

    def test_verify_rejects_manifest_and_elf_changes(self):
        self.make_stage()
        apk = self.make_apk()
        for altered in (XML.replace("=true", "=false"), XML + "E: service\n",
                        XML + "E: activity-alias\n", XML.replace("=false", "=true"),
                        XML.replace(" E: application\n", " E: application\n  A: debuggable=true\n"),
                        XML.replace("android.app.NativeActivity", "android.app.NativeActivityEvil"),
                        XML.replace('name="android.app.NativeActivity"', 'name="evil.Activity"\n   A: label="android.app.NativeActivity"')):
            def fake(arguments, capture=False):
                if "xmltree" in [str(a) for a in arguments]:
                    return altered
                return self.fake_run(arguments, capture)
            with self.subTest(xml=altered), patch.object(export, "run", side_effect=fake), self.assertRaises(ValueError):
                export.verify_apk(apk, self.output, unsigned=True)
        for wrong in ("Machine: x86-64\n", "T nova_tick\n"):
            def fake(arguments, capture=False):
                if Path(arguments[0]).name in ("llvm-readelf", "llvm-nm"):
                    return wrong
                return self.fake_run(arguments, capture)
            with self.subTest(native=wrong), patch.object(export, "run", side_effect=fake), self.assertRaises(ValueError):
                export.verify_apk(apk, self.output, unsigned=True)

    def test_signature_debug_wrong_cert_and_missing_v2_rejected(self):
        outputs = (SIGNATURE.replace("CN=Personal Test", "CN=Android Debug, O=Android"),
                   SIGNATURE.replace("true", "false"), SIGNATURE.replace(CERT, "cd" * 32),
                   SIGNATURE + "Signer #2 certificate SHA-256 digest: " + CERT)
        for output in outputs:
            with self.subTest(output=output), patch.object(export, "run", return_value=output), self.assertRaises(ValueError):
                export.verify_signature(Path("fake.apk"), CERT, release=True)

    def test_build_release_only_and_version_history(self):
        self.make_stage()
        args = argparse.Namespace(export=self.output, previous_export=None)
        with patch.object(export, "run", side_effect=self.fake_run), contextlib.redirect_stdout(io.StringIO()):
            export.build_export(args)
            export.build_export(args)
            self.assertTrue(any(":app:assembleRelease" in call for call in self.invocations))
            self.assertFalse(any(":app:assembleDebug" in call for call in self.invocations))
            (self.project / "main.lua").write_text("function update() end -- changed\n")
            second = self.make_stage(self.root / "second")
            with self.assertRaisesRegex(ValueError, "increase"):
                export.build_export(argparse.Namespace(export=second, previous_export=None))

    def test_runtime_apk_change_requires_increment_even_with_unchanged_game(self):
        self.prepare_signing()
        def changed_runtime(arguments, capture=False):
            result = self.fake_run(arguments, capture)
            if Path(arguments[0]).name == "gradlew":
                apk = self.output / "android-build/outputs/apk/release/app-release-unsigned.apk"
                with zipfile.ZipFile(apk, "a") as archive:
                    archive.writestr("changed-build-metadata", b"runtime changed")
            return result
        with patch.object(export, "run", side_effect=changed_runtime), self.assertRaisesRegex(ValueError, "APK changed"):
            export.build_export(argparse.Namespace(export=self.output, previous_export=None))
        with patch.object(export.sys.stdin, "isatty", return_value=True), \
                patch.object(export, "run", side_effect=self.fake_run), self.assertRaisesRegex(ValueError, "exact export"):
            export.sign_export(self.signing_args())

    def signing_args(self):
        key = self.root / "external-key.jks"
        key.write_text("isolated fake tool placeholder, not a real key")
        return argparse.Namespace(export=self.output, keystore=key, alias="personal", certificate_sha256=CERT)

    def prepare_signing(self):
        self.make_stage()
        with patch.object(export, "run", side_effect=self.fake_run), contextlib.redirect_stdout(io.StringIO()):
            export.build_export(argparse.Namespace(export=self.output, previous_export=None))
        return self.signing_args()

    def test_signing_uses_terminal_and_external_key_without_password_arguments(self):
        args = self.prepare_signing()
        with patch.object(sys_stdin := export.sys.stdin, "isatty", return_value=False), self.assertRaisesRegex(ValueError, "interactive"):
            export.sign_export(args)
        with patch.object(sys_stdin, "isatty", return_value=True), \
                patch.object(export, "run", side_effect=self.fake_run), contextlib.redirect_stdout(io.StringIO()):
            export.sign_export(args)
        calls = [call for call in self.invocations if Path(call[0]).name == "apksigner" and "sign" in call]
        self.assertEqual(len(calls), 1)
        self.assertNotIn("--ks-pass", calls[0])
        self.assertNotIn("--key-pass", calls[0])
        self.assertTrue((self.output / (CONFIG["applicationId"] + "-1-release.apk")).is_file())
        self.assertEqual(export.read_json(export.HISTORY)[CONFIG["applicationId"]]["certificateSha256"], CERT)

    def test_sign_failure_never_publishes_output_or_debug_fallback(self):
        args = self.prepare_signing()
        def fake(arguments, capture=False):
            if "sign" in [str(arg) for arg in arguments]:
                raise subprocess.CalledProcessError(1, arguments)
            return self.fake_run(arguments, capture)
        with patch.object(export.sys.stdin, "isatty", return_value=True), patch.object(export, "run", side_effect=fake):
            with self.assertRaises(subprocess.CalledProcessError):
                export.sign_export(args)
        self.assertFalse(list(self.output.glob("*-release.apk")))
        self.assertFalse(list(self.output.glob(".nova-sign-*")))
        self.assertIsNone(export.read_json(export.HISTORY)[CONFIG["applicationId"]]["certificateSha256"])

    def test_in_repo_key_and_certificate_change_refused(self):
        args = self.prepare_signing()
        key = self.root / "repository/key.jks"
        key.parent.mkdir()
        (key.parent / ".git").mkdir()
        key.write_text("fake")
        args.keystore = key
        with self.assertRaisesRegex(ValueError, "outside"):
            export.sign_export(args)
        args = self.signing_args()
        data = export.read_json(export.HISTORY)
        data[CONFIG["applicationId"]]["certificateSha256"] = "cd" * 32
        export.write_json(export.HISTORY, data)
        with patch.object(export.sys.stdin, "isatty", return_value=True), \
                patch.object(export, "run", side_effect=self.fake_run), self.assertRaisesRegex(ValueError, "Certificate differs"):
            export.sign_export(args)


if __name__ == "__main__":
    unittest.main()
