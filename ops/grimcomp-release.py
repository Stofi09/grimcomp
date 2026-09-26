#!/usr/bin/env python3
"""Deterministic artifacts and a scoped, offline Grimcomp static publisher.

Never invokes npm, systemctl, nginx, a shell, or a database. API artifacts can
be staged, but only static web releases can be activated by this program.
"""
import argparse
import contextlib
import fcntl
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tarfile
import tempfile

FORMAT = "grimcomp-release-v1"
MAX_BYTES = 64 * 1024 * 1024
MAX_FILES = 4096
MAX_MANIFEST = 1024 * 1024
MAX_TAR = MAX_BYTES + MAX_MANIFEST + (MAX_FILES + 1) * 1024 + 10240
MIN_FREE_BYTES = 10 * 1024**3
WRITE_OVERHEAD_BYTES = 1024 * 1024
RELEASE = re.compile(r"[a-z0-9][a-z0-9._-]{0,79}\Z")
COMMIT = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
HASH = re.compile(r"[0-9a-f]{64}\Z")
MARKER = ".grimcomp-release-root"
API_FILES = {"index.mjs", "app.mjs", "database.mjs", "clientAddress.mjs"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def decode_json(data):
    def object_fields(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate JSON field")
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=object_fields)


def safe_name(name, kind):
    parts = PurePosixPath(name).parts
    require(name and not name.startswith("/") and "\\" not in name
            and str(PurePosixPath(name)) == name
            and all(re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]*", p) for p in parts),
            "unsafe artifact path")
    if kind == "web":
        require(parts[0] == "site" and len(parts) >= 2, "web path outside site")
        relative = parts[1:]
        require(relative in [("index.html",), ("favicon.svg",)]
                or (relative[0] in ("assets", "content") and len(relative) == 2),
                "unexpected static file")
        if relative[0] == "assets":
            require(re.fullmatch(r".+-[A-Za-z0-9_-]{6,}\.[a-z0-9]+", relative[1]),
                    "assets must use fingerprinted Vite filenames")
        if relative[0] == "content":
            require(relative[1].endswith(".json"), "content must be JSON")
    else:
        require((len(parts) == 2 and parts[0] == "server" and parts[1] in API_FILES)
                or (len(parts) == 3 and parts[:2] == ("server", "migrations")
                    and re.fullmatch(r"[0-9]{3}_[a-z0-9_]+\.sql", parts[2])),
                "unexpected API file; update the reviewed allowlist for new modules")


def regular_bytes(path, maximum=None):
    maximum = MAX_BYTES if maximum is None else maximum
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "file is not one regular, unlinked file")
        require(info.st_size <= maximum, "file too large")
        data = source.read(maximum + 1)
        after = os.fstat(source.fileno())
        require(len(data) == info.st_size and after.st_size == info.st_size
                and after.st_mtime_ns == info.st_mtime_ns, "file changed during read")
        return data


def validate_manifest(manifest, files):
    require(isinstance(manifest, dict) and set(manifest) ==
            {"format", "kind", "release", "source_commit", "files"}, "invalid manifest fields")
    require(manifest["format"] == FORMAT and manifest["kind"] in ("web", "api"), "unsupported artifact")
    require(isinstance(manifest["release"], str) and RELEASE.fullmatch(manifest["release"]), "invalid release")
    require(isinstance(manifest["source_commit"], str) and COMMIT.fullmatch(manifest["source_commit"]), "invalid commit")
    inventory = manifest["files"]
    require(isinstance(inventory, dict) and 0 < len(inventory) <= MAX_FILES and set(inventory) == set(files),
            "manifest file inventory differs")
    require(sum(map(len, files.values())) <= MAX_BYTES, "artifact exceeds byte bound")
    for name, data in files.items():
        safe_name(name, manifest["kind"])
        require(inventory[name] == {"bytes": len(data), "sha256": digest(data)}, "file fingerprint mismatch")
    if manifest["kind"] == "web":
        require("site/index.html" in files and "site/content/manifest.json" in files, "missing web entrypoints")
        catalog = decode_json(files["site/content/manifest.json"])
        packs = catalog.get("packs") if isinstance(catalog, dict) else catalog
        require(isinstance(packs, list) and packs and all(isinstance(p, str) for p in packs), "invalid content manifest")
        for pack in packs:
            require("site/content/" + pack in files, "missing content pack")
            decode_json(files["site/content/" + pack])
    else:
        require({"server/" + name for name in API_FILES} <= files.keys()
                and "server/migrations/001_accounts.sql" in files, "missing account server modules")


def package(kind, source, output, release, commit):
    require(source.is_dir() and not source.is_symlink(), "source must be a real directory")
    files = {}
    if kind == "web":
        candidates = sorted(source.rglob("*"))
    else:
        candidates = [source / name for name in sorted(API_FILES)]
        require((source / "migrations").is_dir() and not (source / "migrations").is_symlink(), "unsafe migrations")
        candidates += sorted((source / "migrations").iterdir())
    for path in candidates:
        require(not path.is_symlink(), "source contains a symlink")
        if path.is_dir():
            continue
        name = ("site/" if kind == "web" else "server/") + path.relative_to(source).as_posix()
        safe_name(name, kind)
        files[name] = regular_bytes(path)
        require(len(files) <= MAX_FILES and sum(map(len, files.values())) <= MAX_BYTES, "artifact exceeds bound")
    manifest = {"format": FORMAT, "kind": kind, "release": release, "source_commit": commit,
                "files": {name: {"bytes": len(data), "sha256": digest(data)} for name, data in files.items()}}
    validate_manifest(manifest, files)
    manifest_bytes = json_bytes(manifest)
    require(len(manifest_bytes) <= MAX_MANIFEST, "manifest too large")
    payload = {"MANIFEST.json": manifest_bytes, **files}
    # Zero timestamps, explicit modes, sorted files, and no gzip filename make
    # repeated packaging of identical validated output byte-for-byte stable.
    with output.open("xb") as target:
        with gzip.GzipFile(fileobj=target, mode="wb", filename="", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as archive:
                for name in sorted(payload):
                    info = tarfile.TarInfo(name)
                    info.size, info.mode, info.mtime = len(payload[name]), 0o444, 0
                    archive.addfile(info, io.BytesIO(payload[name]))
        target.flush()
        os.fsync(target.fileno())
    return digest(output.read_bytes())


def regular_tarinfo():
    # Our writer emits only regular USTAR members. Reject raw extension headers
    # before tarfile can parse GNU sparse tables or PAX/long-name payloads.
    class RegularTarInfo(tarfile.TarInfo):
        @classmethod
        def frombuf(cls, buffer, encoding, errors):
            if hasattr(tarfile.TarInfo, "_frombuf"):
                return super().frombuf(buffer, encoding, errors)
            return cls.checked(super().frombuf(buffer, encoding, errors))

        @classmethod
        def _frombuf(cls, buffer, encoding, errors, **kwargs):
            return cls.checked(super()._frombuf(buffer, encoding, errors, **kwargs))

        @classmethod
        def checked(cls, entry):
            require(entry.type in (tarfile.REGTYPE, tarfile.AREGTYPE),
                    "unsupported raw tar metadata or entry type")
            require(0 <= entry.size <= MAX_BYTES, "raw tar member exceeds bound")
            return entry
    return RegularTarInfo


def read_artifact(path, expected_hash):
    require(HASH.fullmatch(expected_hash), "provide the reviewed artifact SHA-256")
    # Compression can add framing and overhead to otherwise valid payloads.
    # Keep its input bound separate from the individual source-file limit.
    archive_bytes = regular_bytes(path, MAX_TAR + 1024 * 1024)
    require(digest(archive_bytes) == expected_hash, "artifact SHA-256 mismatch")
    # Bound the full tar stream before its parser can consume GNU/PAX extension
    # metadata, which is otherwise read before a regular member reaches us.
    with gzip.GzipFile(fileobj=io.BytesIO(archive_bytes), mode="rb") as compressed:
        tar_bytes = compressed.read(MAX_TAR + 1)
    require(len(tar_bytes) <= MAX_TAR, "expanded tar stream exceeds bound")
    files, total = {}, 0
    # Never extract an archive. Read bounded regular members and write verified
    # paths ourselves; links, special files, duplicates, and unexpected paths fail.
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:", tarinfo=regular_tarinfo()) as archive:
        for entry in archive:
            require(entry.isreg() and entry.name not in files and 0 <= entry.size <= MAX_BYTES,
                    "unsafe or duplicate tar member")
            require(len(files) < MAX_FILES + 1, "too many archive members")
            total += entry.size
            require(total <= MAX_BYTES + MAX_MANIFEST, "unpacked artifact exceeds bound")
            if entry.name == "MANIFEST.json":
                require(entry.size <= MAX_MANIFEST, "manifest too large")
            else:
                require(entry.name.startswith(("site/", "server/")), "unexpected tar member")
            files[entry.name] = archive.extractfile(entry).read(entry.size + 1)
            require(len(files[entry.name]) == entry.size, "short archive member")
        require(not any(tar_bytes[archive.offset:]), "non-padding data follows tar end marker")
    require("MANIFEST.json" in files, "missing artifact manifest")
    manifest = decode_json(files.pop("MANIFEST.json"))
    validate_manifest(manifest, files)
    return manifest, files


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def owned_directory(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and path.resolve() == path and info.st_uid == os.geteuid()
            and not info.st_mode & 0o022, "unsafe directory ownership, permissions, or symlink")


def root_path(path, kind):
    path = Path(os.path.abspath(path))
    require(path.name == ("grimcomp" if kind == "web" else "grimcomp-api"), "root must be scoped to Grimcomp")
    require(path.parent.resolve() == path.parent, "root parent contains symlinks")
    return path


def init_root(path, kind):
    path = root_path(path, kind)
    if not path.exists():
        path.mkdir(mode=0o755)
    owned_directory(path)
    if (path / MARKER).exists():
        check_root(path, kind)
        return
    require(not list(path.iterdir()), "refusing to initialize a nonempty destination")
    (path / "releases").mkdir(mode=0o755)
    (path / "assets").mkdir(mode=0o755)
    (path / ".publish.lock").touch(mode=0o600, exist_ok=False)
    write_file(path / MARKER, json_bytes({"format": FORMAT, "kind": kind}), 0o444)
    fsync_dir(path)


def check_root(path, kind):
    require(root_path(path, kind) == path, "invalid root")
    for directory in [path, path / "releases", path / "assets"]:
        owned_directory(directory)
    require(regular_bytes(path / MARKER) == json_bytes({"format": FORMAT, "kind": kind}), "wrong root marker")
    info = (path / MARKER).stat()
    require(info.st_uid == os.geteuid() and not info.st_mode & 0o222, "writable root marker")


@contextlib.contextmanager
def locked_root(path, kind):
    check_root(path, kind)
    fd = os.open(path / ".publish.lock", os.O_RDWR | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
                and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600, "unsafe publish lock")
        fcntl.flock(fd, fcntl.LOCK_EX)
        check_root(path, kind)
        yield
    finally:
        os.close(fd)


def write_file(path, data, mode=0o444):
    with path.open("xb") as output:
        output.write(data)
        output.flush()
        os.fchmod(output.fileno(), mode)
        os.fsync(output.fileno())


def write_budget(path, values):
    # Account for allocated file blocks plus directory/metadata overhead.
    block = max(4096, os.statvfs(path).f_frsize)
    return sum(((len(data) + block - 1) // block) * block for data in values) + WRITE_OVERHEAD_BYTES


def require_capacity(path, additional_bytes=0):
    require(shutil.disk_usage(path).free >= MIN_FREE_BYTES + additional_bytes,
            "insufficient disk space to preserve the 10 GiB reserve")


def missing_assets(path, files):
    pending = {}
    for name, data in files.items():
        if name.startswith("site/assets/"):
            asset = path / "assets" / name.removeprefix("site/assets/")
            if asset.exists() or asset.is_symlink():
                require(regular_bytes(asset) == data and asset.stat().st_uid == os.geteuid()
                        and not asset.stat().st_mode & 0o222, "immutable shared-asset filename collision")
            else:
                pending[asset] = data
    return pending


def verify_release(path):
    owned_directory(path)
    require(not path.stat().st_mode & 0o222, "release root is writable")
    manifest = decode_json(regular_bytes(path / "MANIFEST.json"))
    require(isinstance(manifest, dict) and isinstance(manifest.get("files"), dict), "invalid staged manifest")
    files = {}
    actual = set()
    for item in path.rglob("*"):
        require(not item.is_symlink(), "symlink in staged release")
        info = item.lstat()
        require(info.st_uid == os.geteuid() and not info.st_mode & 0o222, "writable or unowned release entry")
        if item.is_dir():
            continue
        name = item.relative_to(path).as_posix()
        actual.add(name)
        if name != "MANIFEST.json":
            files[name] = regular_bytes(item)
    require(actual == set(manifest["files"]) | {"MANIFEST.json"}, "staged inventory changed")
    validate_manifest(manifest, files)
    return manifest, files


def stage(path, manifest, files):
    destination = path / "releases" / manifest["release"]
    if destination.exists() or destination.is_symlink():
        existing, existing_files = verify_release(destination)
        require(existing == manifest and existing_files == files, "release ID already contains different bytes")
        return destination
    payload = {"MANIFEST.json": json_bytes(manifest), **files}
    # A web publication retains both the release copy and its new shared assets.
    # Check the combined peak on each destination even if mounted separately.
    asset_bytes = (write_budget(path / "assets", missing_assets(path, files).values())
                   if manifest["kind"] == "web" else 0)
    require_capacity(path / "releases", write_budget(path / "releases", payload.values()) + asset_bytes)
    if asset_bytes:
        require_capacity(path / "assets", write_budget(path / "releases", payload.values()) + asset_bytes)
    temporary = Path(tempfile.mkdtemp(prefix=".stage-", dir=path / "releases"))
    try:
        remaining = list(payload.values())
        for name, data in payload.items():
            require_capacity(temporary, write_budget(temporary, remaining) + asset_bytes)
            target = temporary / name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            write_file(target, data)
            remaining.pop(0)
        for directory in sorted([p for p in temporary.rglob("*") if p.is_dir()], key=lambda p: len(p.parts), reverse=True):
            directory.chmod(0o555)
            fsync_dir(directory)
        temporary.chmod(0o555)
        fsync_dir(temporary)
        verify_release(temporary)
        require_capacity(temporary, asset_bytes)
        temporary.rename(destination)
        fsync_dir(destination.parent)
    except BaseException:
        # Only our just-created stage; committed/previous releases are never removed.
        if temporary.exists():
            for directory in [temporary, *[p for p in temporary.rglob("*") if p.is_dir()]]:
                directory.chmod(0o755)
            shutil.rmtree(temporary)
        raise
    return destination


def current_release(path, verify_contents=True):
    current = path / "current"
    if not current.exists() and not current.is_symlink():
        return None
    require(current.is_symlink(), "current must be a managed symlink")
    target = os.readlink(current)
    match = re.fullmatch(r"releases/([a-z0-9][a-z0-9._-]{0,79})/site", target)
    require(match, "unexpected current target")
    if verify_contents:
        require(current.exists(), "dangling current target")
        verify_release(path / "releases" / match[1])
    return match[1]


def activate_web(path, release):
    require(RELEASE.fullmatch(release), "invalid release")
    manifest, files = verify_release(path / "releases" / release)
    require(manifest["kind"] == "web" and manifest["release"] == release, "not the selected web release")
    # Recovery must still work when the active release is corrupt or missing.
    # Validate its managed pointer syntax without trusting/reading its contents;
    # the selected replacement above must pass full immutable verification.
    previous = current_release(path, verify_contents=False)
    pending = missing_assets(path, files)
    remaining = list(pending.values())
    require_capacity(path / "assets", write_budget(path / "assets", remaining))
    for asset, data in pending.items():
        require_capacity(path / "assets", write_budget(path / "assets", remaining))
        fd, name = tempfile.mkstemp(prefix=".asset-", dir=path / "assets")
        temporary_asset = Path(name)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(data)
                output.flush()
                os.fchmod(output.fileno(), 0o444)
                os.fsync(output.fileno())
            require_capacity(path / "assets", WRITE_OVERHEAD_BYTES)
            temporary_asset.replace(asset)
        finally:
            if temporary_asset.exists():
                temporary_asset.unlink()
        remaining.pop(0)
    fsync_dir(path / "assets")
    require_capacity(path, WRITE_OVERHEAD_BYTES)
    # The current symlink is the only activation state. Old releases and hashed
    # assets are retained; rollback revalidates them and performs this same switch.
    fd, name = tempfile.mkstemp(prefix=".current-", dir=path)
    os.close(fd)
    temporary = Path(name)
    temporary.unlink()
    try:
        temporary.symlink_to(f"releases/{release}/site")
        temporary.replace(path / "current")
        fsync_dir(path)
    finally:
        if temporary.is_symlink():
            temporary.unlink()
    return {"current": release, "previous": previous}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    pack = sub.add_parser("package")
    pack.add_argument("--kind", choices=["web", "api"], required=True)
    pack.add_argument("--source", type=Path, required=True)
    pack.add_argument("--output", type=Path, required=True)
    pack.add_argument("--release", required=True)
    pack.add_argument("--source-commit", required=True)
    for name in ["init", "stage", "publish", "rollback", "status"]:
        command = sub.add_parser(name)
        command.add_argument("--kind", choices=["web", "api"], default="web")
        command.add_argument("--root", type=Path)
        if name in ["stage", "publish"]:
            command.add_argument("--archive", type=Path, required=True)
            command.add_argument("--sha256", required=True)
        if name == "rollback":
            command.add_argument("--release", required=True)
    args = parser.parse_args()
    if args.command == "package":
        print(package(args.kind, args.source, args.output, args.release, args.source_commit))
        return
    root = root_path(args.root or Path("/srv/grimcomp" if args.kind == "web" else "/srv/grimcomp-api"), args.kind)
    if args.command == "init":
        init_root(root, args.kind)
        print(json.dumps({"initialized": str(root), "kind": args.kind}))
        return
    require(args.kind == "web" or args.command == "stage", "API releases can only be staged; activation requires a database-aware deploy")
    with locked_root(root, args.kind):
        if args.command in ["stage", "publish"]:
            manifest, files = read_artifact(args.archive, args.sha256)
            require(manifest["kind"] == args.kind, "wrong artifact kind for destination")
            destination = stage(root, manifest, files)
            result = ({"staged": str(destination)} if args.command == "stage"
                      else activate_web(root, manifest["release"]))
        elif args.command == "rollback":
            result = activate_web(root, args.release)
        else:
            result = {"current": current_release(root)}
        print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, tarfile.TarError) as error:
        print(f"grimcomp-release: {error}", file=sys.stderr)
        sys.exit(1)
