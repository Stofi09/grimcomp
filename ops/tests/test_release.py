import hashlib
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "grimcomp-release.py"
spec = importlib.util.spec_from_file_location("release", SCRIPT)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
COMMIT = "a" * 40


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / "grimcomp"
        self.web = self.base / "dist"
        (self.web / "assets").mkdir(parents=True)
        (self.web / "content").mkdir()
        (self.web / "index.html").write_text('<script type="module" src="./assets/app-abcdef12.js"></script>')
        (self.web / "assets/app-abcdef12.js").write_text("window.release = 1;")
        (self.web / "content/manifest.json").write_text('{"packs":["core.json"]}')
        (self.web / "content/core.json").write_text('{"version":1}')
        release.init_root(self.root, "web")

    def tearDown(self):
        # Publisher releases intentionally have read-only directories.
        for parent, directories, _ in os.walk(self.base):
            os.chmod(parent, 0o755)
            for directory in directories:
                if not (Path(parent) / directory).is_symlink():
                    os.chmod(Path(parent) / directory, 0o755)
        self.temp.cleanup()

    def artifact(self, name="one"):
        path = self.base / (name + ".tar.gz")
        sha = release.package("web", self.web, path, name, COMMIT)
        return path, sha

    def cli(self, *args, ok=True):
        result = subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, ok, result.stderr)
        return json.loads(result.stdout) if ok else result

    def publish(self, path, sha, ok=True):
        return self.cli("publish", "--root", self.root, "--archive", path, "--sha256", sha, ok=ok)

    def test_package_is_reproducible_despite_mtime(self):
        first, first_sha = self.artifact()
        os.utime(self.web / "index.html", (100, 100))
        second = self.base / "second.tar.gz"
        second_sha = release.package("web", self.web, second, "one", COMMIT)
        self.assertEqual(first_sha, second_sha)
        self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_publish_upgrade_rollback_retains_old_assets_and_content(self):
        first, first_sha = self.artifact()
        self.assertEqual(self.publish(first, first_sha), {"current": "one", "previous": None})
        (self.web / "assets/app-abcdef12.js").unlink()
        (self.web / "assets/app-fedcba98.js").write_text("window.release = 2;")
        (self.web / "index.html").write_text('<script src="./assets/app-fedcba98.js"></script>')
        (self.web / "content/core.json").write_text('{"version":2}')
        second, second_sha = self.artifact("two")
        self.assertEqual(self.publish(second, second_sha)["previous"], "one")
        self.assertEqual((self.root / "current/content/core.json").read_text(), '{"version":2}')
        self.assertEqual((self.root / "assets/app-abcdef12.js").read_text(), "window.release = 1;")
        self.cli("rollback", "--root", self.root, "--release", "one")
        self.assertEqual((self.root / "current/content/core.json").read_text(), '{"version":1}')
        self.assertTrue((self.root / "assets/app-fedcba98.js").is_file())

    def test_repeat_publish_is_idempotent(self):
        path, sha = self.artifact()
        self.publish(path, sha)
        self.assertEqual(self.publish(path, sha), {"current": "one", "previous": "one"})

    def test_stage_reserves_both_release_and_retained_asset_copies(self):
        path, sha = self.artifact()
        self.publish(path, sha)
        (self.web / "assets/app-fedcba98.js").write_bytes(b"x" * (2 * 1024 * 1024))
        path, sha = self.artifact("two")
        manifest, files = release.read_artifact(path, sha)
        # Enough for the staged payload alone, but not its additional asset copy.
        only_stage = release.write_budget(self.root / "releases", [release.json_bytes(manifest), *files.values()])
        with patch.object(release.shutil, "disk_usage", return_value=SimpleNamespace(free=release.MIN_FREE_BYTES + only_stage)), \
                patch.object(release, "write_file", wraps=release.write_file) as writes, \
                self.assertRaisesRegex(ValueError, "10 GiB reserve"):
            release.stage(self.root, manifest, files)
        writes.assert_not_called()
        self.assertEqual(release.current_release(self.root), "one")
        self.assertFalse((self.root / "releases/two").exists())
        self.assertEqual(list((self.root / "releases").glob(".stage-*")), [])

    def test_disk_exhaustion_during_stage_cleans_partial_and_preserves_current(self):
        path, sha = self.artifact()
        self.publish(path, sha)
        (self.web / "content/core.json").write_text('{"version":2}')
        path, sha = self.artifact("two")
        manifest, files = release.read_artifact(path, sha)
        high = SimpleNamespace(free=100 * 1024**3)
        low = SimpleNamespace(free=release.MIN_FREE_BYTES - 1)
        with patch.object(release.shutil, "disk_usage", side_effect=[high, high, high, low]), \
                patch.object(release, "write_file", wraps=release.write_file) as writes, \
                self.assertRaisesRegex(ValueError, "10 GiB reserve"):
            release.stage(self.root, manifest, files)
        self.assertEqual(writes.call_count, 1)
        self.assertEqual(release.current_release(self.root), "one")
        self.assertFalse((self.root / "releases/two").exists())
        self.assertEqual(list((self.root / "releases").glob(".stage-*")), [])

    def test_disk_exhaustion_during_asset_copy_does_not_activate(self):
        path, sha = self.artifact()
        self.publish(path, sha)
        (self.web / "assets/app-fedcba98.js").write_text("window.release = 2;")
        path, sha = self.artifact("two")
        manifest, files = release.read_artifact(path, sha)
        release.stage(self.root, manifest, files)
        high = SimpleNamespace(free=100 * 1024**3)
        low = SimpleNamespace(free=release.MIN_FREE_BYTES - 1)
        with patch.object(release.shutil, "disk_usage", side_effect=[high, high, low]), \
                self.assertRaisesRegex(ValueError, "10 GiB reserve"):
            release.activate_web(self.root, "two")
        self.assertEqual(release.current_release(self.root), "one")
        self.assertTrue((self.root / "releases/two").is_dir())
        self.assertFalse((self.root / "assets/app-fedcba98.js").exists())
        self.assertEqual(list((self.root / "assets").glob(".asset-*")), [])

    def test_digest_failure_preserves_current(self):
        path, sha = self.artifact()
        self.publish(path, sha)
        self.publish(path, "0" * 64, ok=False)
        self.assertEqual(release.current_release(self.root), "one")

    def test_rejects_symlink_archive_duplicate_json_and_expanded_stream(self):
        path, sha = self.artifact()
        link = self.base / "archive-link.tar.gz"
        link.symlink_to(path)
        self.publish(link, sha, ok=False)
        with self.assertRaises(ValueError):
            release.decode_json('{"format":"one","format":"two"}')
        with patch.object(release, "MAX_TAR", 100):
            with self.assertRaises(ValueError):
                release.read_artifact(path, sha)

    def test_payload_near_bound_round_trips_despite_compression_overhead(self):
        (self.web / "assets/app-abcdef12.js").write_bytes(os.urandom(3900))
        with patch.object(release, "MAX_BYTES", 4096):
            path, sha = self.artifact()
            self.assertGreater(path.stat().st_size, release.MAX_BYTES)
            manifest, files = release.read_artifact(path, sha)
            self.assertEqual(manifest["release"], "one")
            self.assertEqual(files["site/assets/app-abcdef12.js"],
                             (self.web / "assets/app-abcdef12.js").read_bytes())

    def test_oversized_manifest_is_rejected_before_creating_artifact(self):
        with patch.object(release, "MAX_MANIFEST", 10), self.assertRaisesRegex(ValueError, "manifest too large"):
            self.artifact()
        self.assertFalse((self.base / "one.tar.gz").exists())

    def test_raw_metadata_is_rejected_before_its_decoder_runs(self):
        for kind in (tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.SOLARIS_XHDTYPE,
                     tarfile.GNUTYPE_SPARSE, tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK):
            entry = tarfile.TarInfo("metadata")
            entry.type, entry.size = kind, 1024 * 1024
            data = gzip.compress(entry.tobuf(format=tarfile.GNU_FORMAT) + bytes(1024), mtime=0)
            path = self.base / "metadata.tar.gz"
            path.write_bytes(data)
            with self.subTest(kind=kind), \
                    patch.object(tarfile.TarInfo, "_proc_pax", side_effect=AssertionError("PAX parser reached")), \
                    patch.object(tarfile.TarInfo, "_proc_sparse", side_effect=AssertionError("sparse parser reached")), \
                    patch.object(tarfile.TarInfo, "_proc_gnulong", side_effect=AssertionError("long-name parser reached")), \
                    self.assertRaisesRegex(ValueError, "unsupported raw tar"):
                release.read_artifact(path, hashlib.sha256(data).hexdigest())

    def test_non_padding_bytes_and_second_tar_after_end_are_rejected(self):
        path, _ = self.artifact()
        original = gzip.decompress(path.read_bytes())
        for trailer in (b"unmanifested trailing bytes", original):
            data = gzip.compress(original + trailer, mtime=0)
            changed = self.base / "trailing.tar.gz"
            changed.write_bytes(data)
            with self.subTest(trailer_bytes=len(trailer)), self.assertRaisesRegex(ValueError, "non-padding data"):
                release.read_artifact(changed, hashlib.sha256(data).hexdigest())

    def test_asset_collision_preserves_current(self):
        path, sha = self.artifact()
        self.publish(path, sha)
        (self.web / "assets/app-abcdef12.js").write_text("different bytes at same hash name")
        path, sha = self.artifact("two")
        self.publish(path, sha, ok=False)
        self.assertEqual(release.current_release(self.root), "one")
        self.assertEqual((self.root / "assets/app-abcdef12.js").read_text(), "window.release = 1;")

    def test_reusing_release_name_for_different_bytes_fails(self):
        path, sha = self.artifact()
        self.publish(path, sha)
        (self.web / "content/core.json").write_text('{"version":2}')
        other = self.base / "other.tar.gz"
        other_sha = release.package("web", self.web, other, "one", COMMIT)
        self.publish(other, other_sha, ok=False)
        self.assertEqual((self.root / "current/content/core.json").read_text(), '{"version":1}')

    def test_rejects_corrupted_or_symlinked_rollback(self):
        path, sha = self.artifact()
        self.publish(path, sha)
        target = self.root / "releases/one/site/index.html"
        target.chmod(0o644)
        target.write_text("corrupt")
        target.chmod(0o444)
        self.cli("rollback", "--root", self.root, "--release", "one", ok=False)
        target.parent.chmod(0o755)
        target.unlink()
        target.symlink_to(self.web / "index.html")
        self.cli("rollback", "--root", self.root, "--release", "one", ok=False)

    def test_rollback_recovers_corrupted_or_missing_current_but_refuses_foreign_pointer(self):
        one, first_sha = self.artifact()
        self.publish(one, first_sha)
        (self.web / "content/core.json").write_text('{"version":2}')
        two, second_sha = self.artifact("two")
        self.publish(two, second_sha)
        damaged = self.root / "releases/two/site/index.html"
        damaged.chmod(0o644)
        damaged.write_text("damaged active release")
        damaged.chmod(0o444)
        self.cli("status", "--root", self.root, ok=False)
        result = self.cli("rollback", "--root", self.root, "--release", "one")
        self.assertEqual(result, {"current": "one", "previous": "two"})
        self.assertEqual(release.current_release(self.root), "one")
        self.assertEqual(damaged.read_text(), "damaged active release")
        current = self.root / "current"
        current.unlink()
        current.symlink_to(self.web)
        self.cli("rollback", "--root", self.root, "--release", "one", ok=False)
        self.assertEqual(current.resolve(), self.web)
        current.unlink()
        current.symlink_to("releases/missing/site")
        result = self.cli("rollback", "--root", self.root, "--release", "one")
        self.assertEqual(result, {"current": "one", "previous": "missing"})
        self.assertEqual(release.current_release(self.root), "one")

    def test_refuses_foreign_or_symlinked_destination(self):
        foreign = self.base / "foreign/grimcomp"
        foreign.mkdir(parents=True)
        (foreign / "user-file").write_text("preserve")
        self.cli("init", "--root", foreign, ok=False)
        self.assertEqual((foreign / "user-file").read_text(), "preserve")
        link = self.base / "linked"
        link.symlink_to(self.base / "foreign", target_is_directory=True)
        self.cli("init", "--root", link / "grimcomp", ok=False)
        self.cli("init", "--root", self.base / "david", ok=False)

    def test_source_secret_symlink_and_missing_catalog_are_rejected(self):
        secret = self.web / ".env"
        secret.write_text("synthetic=not-a-secret")
        with self.assertRaises(ValueError):
            self.artifact()
        secret.unlink()
        secret.symlink_to(self.web / "index.html")
        with self.assertRaises(ValueError):
            self.artifact()
        secret.unlink()
        (self.web / "content/core.json").unlink()
        with self.assertRaises(ValueError):
            self.artifact()

    def test_archive_paths_links_duplicates_and_content_tampering_are_rejected(self):
        valid, _ = self.artifact()
        with tarfile.open(valid, "r:gz") as original:
            entries = [(entry, original.extractfile(entry).read()) for entry in original]
        cases = ["traversal", "link", "duplicate", "tamper"]
        for case in cases:
            with self.subTest(case=case):
                output = self.base / (case + ".tar.gz")
                with tarfile.open(output, "w:gz") as archive:
                    for entry, data in entries:
                        if case == "tamper" and entry.name == "site/index.html":
                            data = b"x" * len(data)
                        archive.addfile(entry, io.BytesIO(data))
                    if case != "tamper":
                        entry = tarfile.TarInfo("site/../../escape" if case == "traversal" else "site/index.html")
                        if case == "link":
                            entry.name = "site/linked.html"
                            entry.type, entry.linkname = tarfile.SYMTYPE, "/etc/passwd"
                        archive.addfile(entry)
                self.publish(output, hashlib.sha256(output.read_bytes()).hexdigest(), ok=False)
                self.assertFalse((self.root / "current").exists())
                self.assertFalse((self.base / "escape").exists())

    def test_concurrent_publish_serializes_complete_releases(self):
        one, sha_one = self.artifact()
        (self.web / "content/core.json").write_text('{"version":2}')
        two, sha_two = self.artifact("two")
        children = [subprocess.Popen([sys.executable, str(SCRIPT), "publish", "--root", str(self.root),
                                     "--archive", str(path), "--sha256", sha], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    for path, sha in [(one, sha_one), (two, sha_two)]]
        for child in children:
            _, stderr = child.communicate(timeout=10)
            self.assertEqual(child.returncode, 0, stderr)
        active = release.current_release(self.root)
        self.assertIn(active, ("one", "two"))
        manifest, _ = release.verify_release(self.root / "releases" / active)
        self.assertEqual(manifest["release"], active)

    def test_api_artifact_excludes_state_and_stages_without_activation(self):
        source = self.base / "server"
        source.mkdir()
        for name in release.API_FILES:
            (source / name).write_text("export {};\n")
        (source / "migrations").mkdir()
        (source / "migrations/001_accounts.sql").write_text("SELECT 1;\n")
        (source / "data").mkdir()
        (source / "data/grimcomp.sqlite").write_text("synthetic private data")
        (source / ".env").write_text("synthetic private env")
        archive = self.base / "api.tar.gz"
        sha = release.package("api", source, archive, "api-one", COMMIT)
        manifest, files = release.read_artifact(archive, sha)
        self.assertEqual(len(files), 5)
        self.assertNotIn(".sqlite", json.dumps(manifest["files"]))
        self.assertNotIn(".env", json.dumps(manifest["files"]))
        api_root = self.base / "grimcomp-api"
        self.cli("init", "--kind", "api", "--root", api_root)
        with patch.object(release.shutil, "disk_usage", return_value=SimpleNamespace(free=release.MIN_FREE_BYTES)), \
                self.assertRaisesRegex(ValueError, "10 GiB reserve"):
            release.stage(api_root, manifest, files)
        self.assertFalse((api_root / "releases/api-one").exists())
        self.assertEqual(list((api_root / "releases").glob(".stage-*")), [])
        self.cli("stage", "--kind", "api", "--root", api_root, "--archive", archive, "--sha256", sha)
        self.assertTrue((api_root / "releases/api-one/server/index.mjs").is_file())
        self.assertFalse((api_root / "current").exists())
        self.cli("publish", "--kind", "api", "--root", api_root, "--archive", archive, "--sha256", sha, ok=False)
        self.publish(archive, sha, ok=False)


if __name__ == "__main__":
    unittest.main()
