import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "grimcomp-sqlite-backup.py"
spec = importlib.util.spec_from_file_location("backup", SCRIPT)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name).resolve()
        self.base.chmod(0o700)
        self.database = self.base / "grimcomp.sqlite"
        self.source = sqlite3.connect(self.database)
        self.source.executescript("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; "
                                 "CREATE TABLE example (value TEXT); PRAGMA user_version=1;")
        source = self.base / "server"
        source.mkdir()
        for name in backup.release.API_FILES:
            (source / name).write_text("export {};\n")
        (source / "migrations").mkdir()
        (source / "migrations/001_accounts.sql").write_text("SELECT 1;\n")
        archive = self.base / "api.tar.gz"
        sha = backup.release.package("api", source, archive, "test", "a" * 40)
        api_root = self.base / "grimcomp-api"
        backup.release.init_root(api_root, "api")
        manifest, files = backup.release.read_artifact(archive, sha)
        staged = backup.release.stage(api_root, manifest, files)
        self.manifest = staged / "MANIFEST.json"
        self.old_umask = os.umask(0o077)

    def tearDown(self):
        self.source.close()
        os.umask(self.old_umask)
        for parent, directories, _ in os.walk(self.base):
            os.chmod(parent, 0o755)
            for directory in directories:
                if not (Path(parent) / directory).is_symlink():
                    os.chmod(Path(parent) / directory, 0o755)
        self.temp.cleanup()

    def test_online_backup_includes_committed_wal_and_opens_independently(self):
        self.source.execute("INSERT INTO example VALUES ('committed in WAL')")
        self.source.commit()
        self.assertTrue(Path(str(self.database) + "-wal").is_file())
        destination = self.base / "snapshot"
        receipt = backup.create_backup(self.database, destination, self.manifest)
        self.assertEqual(receipt["schema_version"], 1)
        self.assertEqual(self.source.execute("PRAGMA journal_mode").fetchone(), ("wal",))
        self.assertFalse((destination / "database.sqlite-wal").exists())
        with sqlite3.connect(destination / "database.sqlite") as restored:
            self.assertEqual(restored.execute("PRAGMA journal_mode").fetchone(), ("delete",))
            self.assertEqual(restored.execute("SELECT value FROM example").fetchall(), [("committed in WAL",)])
            self.assertEqual(restored.execute("PRAGMA integrity_check").fetchone(), ("ok",))
        self.assertEqual((destination / "database.sqlite").stat().st_mode & 0o777, 0o600)
        self.source.execute("INSERT INTO example VALUES ('after backup')")
        self.source.commit()
        with sqlite3.connect(destination / "database.sqlite") as restored:
            self.assertEqual(restored.execute("SELECT count(*) FROM example").fetchone()[0], 1)

    def test_refuses_overwrite_or_public_parent(self):
        destination = self.base / "snapshot"
        destination.mkdir()
        with self.assertRaises(ValueError):
            backup.create_backup(self.database, destination, self.manifest)
        destination.rmdir()
        self.base.chmod(0o755)
        with self.assertRaises(ValueError):
            backup.create_backup(self.database, destination, self.manifest)
        self.assertFalse(destination.exists())

    def test_future_schema_is_not_published(self):
        self.source.execute("PRAGMA user_version=2")
        self.source.commit()
        destination = self.base / "snapshot"
        with self.assertRaises(ValueError):
            backup.create_backup(self.database, destination, self.manifest)
        self.assertFalse(destination.exists())
        self.assertEqual(list(self.base.glob(".grimcomp-backup-*")), [])

    def test_preflight_reserves_whole_main_and_wal_before_copying(self):
        for _ in range(4):
            self.source.execute("INSERT INTO example VALUES (?)", ("x" * 20000,))
            self.source.commit()
            self.source.execute("DELETE FROM example")
            self.source.commit()
        logical_bytes = self.source.execute("PRAGMA page_size").fetchone()[0] * self.source.execute("PRAGMA page_count").fetchone()[0]
        physical_bytes = self.database.stat().st_size + Path(str(self.database) + "-wal").stat().st_size
        self.assertGreater(physical_bytes, logical_bytes)
        # This would admit only a logical-page estimate and omit the larger WAL.
        available = backup.release.MIN_FREE_BYTES + logical_bytes * 2 + backup.release.WRITE_OVERHEAD_BYTES
        destination = self.base / "snapshot"
        with patch.object(backup.release.shutil, "disk_usage", return_value=SimpleNamespace(free=available)) as disk, \
                self.assertRaisesRegex(ValueError, "10 GiB reserve"):
            backup.create_backup(self.database, destination, self.manifest)
        self.assertEqual(disk.call_count, 1)
        self.assertFalse(destination.exists())
        self.assertEqual(list(self.base.glob(".grimcomp-backup-*")), [])
        self.assertEqual(self.source.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_reserve_loss_during_copy_or_before_publish_never_activates_backup(self):
        self.source.execute("INSERT INTO example VALUES ('source survives')")
        self.source.commit()
        for when, marker in (("progress", "database.sqlite"), ("publication", "BACKUP.json")):
            with self.subTest(when=when):
                destination = self.base / when

                def disk(path):
                    free = backup.release.MIN_FREE_BYTES - 1 if (Path(path) / marker).exists() else 100 * 1024**3
                    return SimpleNamespace(free=free)

                with patch.object(backup.release.shutil, "disk_usage", side_effect=disk) as observed, \
                        self.assertRaisesRegex(ValueError, "10 GiB reserve"):
                    backup.create_backup(self.database, destination, self.manifest)
                self.assertGreaterEqual(observed.call_count, 2)
                self.assertFalse(destination.exists())
                self.assertEqual(list(self.base.glob(".grimcomp-backup-*")), [])
                self.assertEqual(self.source.execute("SELECT value FROM example").fetchall(), [("source survives",)])


if __name__ == "__main__":
    unittest.main()
