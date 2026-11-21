"""Fingerprint the source directories copied into the ValuX runtime image."""

import hashlib
import sys
from pathlib import Path


def fingerprint(root):
    digest = hashlib.sha256()
    for directory in ("backend", "frontend", "resources"):
        for path in sorted((root / directory).rglob("*")):
            if not path.is_file() or "__pycache__" in path.parts or path.suffix == ".pyc" or path.name == ".DS_Store":
                continue
            if path.name.startswith("~$") and path.suffix == ".xlsx":
                continue  # Transient Excel lock files are excluded by .dockerignore.
            digest.update(path.relative_to(root).as_posix().encode() + b"\0")
            digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


if __name__ == "__main__":
    print(fingerprint(Path(sys.argv[1] if len(sys.argv) > 1 else ".")))
