#!/usr/bin/env python3
"""Create a private, coherent SQLite backup through SQLite's online backup API.

Never stops a service or copies a live main database file. Run as an identity
that can read Grimcomp state and write the private backup directory. No timers,
retention/deletion, offsite transfer, or automatic live restore are performed.
"""
import argparse
from contextlib import closing
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import sys
import tempfile
import time

spec = importlib.util.spec_from_file_location("grimcomp_release", Path(__file__).with_name("grimcomp-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def check(condition, message):
    if not condition:
        raise ValueError(message)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def create_backup(database, destination, api_manifest, timeout=60):
    database, destination, api_manifest = map(lambda p: Path(os.path.abspath(p)), (database, destination, api_manifest))
    check(database.resolve() == database and database.is_file(), "database must be a canonical regular file")
    check(api_manifest.resolve() == api_manifest and api_manifest.is_file(), "provide the canonical API release manifest")
    check(destination.parent.resolve() == destination.parent, "backup parent must be canonical")
    parent_info = destination.parent.stat()
    check(stat.S_ISDIR(parent_info.st_mode) and parent_info.st_uid == os.geteuid()
          and not parent_info.st_mode & 0o077, "backup parent must be privately owned (mode 0700)")
    check(not destination.exists() and not destination.is_symlink(), "backup destination already exists")
    check(api_manifest.name == "MANIFEST.json", "use the staged API manifest")
    manifest, _ = release.verify_release(api_manifest.parent)
    manifest_bytes = api_manifest.read_bytes()
    check(manifest.get("format") == "grimcomp-release-v1" and manifest.get("kind") == "api",
          "not a Grimcomp API release manifest")
    check(0 < timeout <= 600, "backup deadline must be 1-600 seconds")
    os.umask(0o077)
    stage = Path(tempfile.mkdtemp(prefix=".grimcomp-backup-", dir=destination.parent))
    try:
        start = time.monotonic()
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=5)) as source:
            source.execute("PRAGMA query_only = ON")
            page_bytes = source.execute("PRAGMA page_size").fetchone()[0]
            source_bytes = page_bytes * source.execute("PRAGMA page_count").fetchone()[0]
            wal = Path(str(database) + "-wal")
            try:
                wal_info = wal.lstat()
                check(stat.S_ISREG(wal_info.st_mode), "database WAL is not a regular file")
                wal_bytes = wal_info.st_size
            except FileNotFoundError:
                wal_bytes = 0
            source_bytes = max(source_bytes, database.stat().st_size + wal_bytes)
            release.require_capacity(stage, source_bytes * 2 + release.WRITE_OVERHEAD_BYTES)
            with closing(sqlite3.connect(stage / "database.sqlite")) as target:
                def progress(_status, remaining, _total):
                    check(time.monotonic() - start < timeout, "SQLite backup exceeded deadline")
                    release.require_capacity(stage, remaining * page_bytes + release.WRITE_OVERHEAD_BYTES)
                source.backup(target, pages=64, progress=progress, sleep=0.05)
                # The copied header inherits WAL mode. Closing a connection
                # does not remove sidecars on every SQLite build, so explicitly
                # make only this independent copy a single-file database.
                check(target.execute("PRAGMA journal_mode = DELETE").fetchone() == ("delete",),
                      "backup could not enter self-contained journal mode")
                check(target.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "backup integrity check failed")
                version = target.execute("PRAGMA user_version").fetchone()[0]
                check(version == 1, "unsupported account schema; review recovery before backing up")
        # The independent destination was checkpointed when leaving WAL mode;
        # verify there is no unaccounted WAL before publishing its main file.
        check(not (stage / "database.sqlite-wal").exists(), "backup has an unexpected WAL")
        verified_manifest, _ = release.verify_release(api_manifest.parent)
        check(verified_manifest == manifest, "API artifact changed during backup")
        fingerprint = hashlib.sha256()
        with (stage / "database.sqlite").open("rb") as database_copy:
            for chunk in iter(lambda: database_copy.read(1024 * 1024), b""):
                fingerprint.update(chunk)
        receipt = {"format": "grimcomp-sqlite-backup-v1", "schema_version": version,
                   "created_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "database_bytes": (stage / "database.sqlite").stat().st_size,
                   "database_sha256": fingerprint.hexdigest(),
                   "api_release": manifest["release"], "source_commit": manifest["source_commit"],
                   "api_manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest()}
        release.require_capacity(stage, len(manifest_bytes) + release.WRITE_OVERHEAD_BYTES)
        (stage / "API-MANIFEST.json").write_bytes(manifest_bytes)
        (stage / "BACKUP.json").write_text(json.dumps(receipt, sort_keys=True) + "\n")
        for file in stage.iterdir():
            file.chmod(0o600)
            with file.open("rb") as stream:
                os.fsync(stream.fileno())
        sync_directory(stage)
        release.require_capacity(stage)
        check(not destination.exists() and not destination.is_symlink(), "backup destination appeared during capture")
        stage.rename(destination)
        sync_directory(destination.parent)
        return receipt
    except BaseException:
        if stage.exists():
            shutil.rmtree(stage)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path("/var/lib/grimcomp/grimcomp.sqlite"))
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--api-manifest", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=60)
    args = parser.parse_args()
    try:
        print(json.dumps(create_backup(args.database, args.destination, args.api_manifest, args.timeout), sort_keys=True))
    except (ValueError, OSError, sqlite3.Error, KeyError) as error:
        print(f"grimcomp-sqlite-backup: {error}", file=sys.stderr)
        sys.exit(1)
