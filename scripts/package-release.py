#!/usr/bin/env python3
"""Stage an offline SatsGuard release locally; never upload or change GitHub."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parent.parent
SOURCE_FILES = (
    ".gitignore", "LICENSE", "README.md", "index.html", "package.json",
    "package-lock.json", "vite.config.js", "docs/demo-script.md",
    "docs/protocol-notes.md", "docs/submission.json", "docs/validation.md",
    "docs/offline-release.md", "demo/index.html", "demo/guide.html",
    "demo/THIRD-PARTY-LICENSES.txt",
    "public/demo.html", "public/favicon.svg",
    "public/guide.html", "scripts/cli.mjs", "scripts/standalone.mjs",
    "scripts/package-release.py", "src/engine.js", "src/fixtures.js",
    "src/main.js", "src/style.css", "tests/engine.test.js",
)
PUBLICATION_FILES = (
    "index.html", "guide.html", "demo.html", "README.md", "LICENSE",
    "THIRD-PARTY-LICENSES.txt", "cover.jpg", "fee-spike.jpg",
    "missing-values.jpg", "satsguard-demo.mp4", "satsguard-demo.srt",
    "satsguard-demo.vtt", "satsguard-history.bundle",
)
SEPARATE_ASSETS = (
    "satsguard-demo.mp4", "satsguard-demo.srt", "satsguard-demo.vtt",
    "satsguard-history.bundle",
)
START_HERE = """SatsGuard — offline PSBT intent inspection

1. Extract the whole satsguard folder from this ZIP.
2. Open index.html in a current desktop browser. No installation is needed.
3. Try the four synthetic testnet examples and read guide.html.
4. Open satsguard-demo.mp4 in a video player for the 2m40s walkthrough.
   demo.html also provides a local browser player. If local-file browser
   restrictions prevent captions loading, use the supplied SRT in a player.
5. For the CLI, tests and build, extract satsguard-source.zip and follow README.md.

Expected checks:
  Recipient swap: blocked; the requested recipient receives zero.
  Fee spike: blocked; the supplied fee exceeds the declared cap.
  Missing input value: review required; the fee cannot be checked.
  Matched intent: no declared checks failed. This is not approval to sign.

SatsGuard never signs, broadcasts, reads keys or contacts a chain API.
Input values are supplied PSBT claims; chain state, ownership and signatures
are unverified. Use the included synthetic fixtures for evaluation.

Originally developed on October 5, 2026, in preparation for BOSS Battle;
not submitted to that event. Prepared for CodeStorm FutureForge evaluation.
OpenAI Codex AI assistance and synthetic demo narration are disclosed.
The original source is MIT licensed; dependency licenses are included.

The GitHub Pages address currently inherits the account's existing custom
domain and does not serve this app. This ZIP is the complete offline artifact.
"""
RELEASE_NOTES = """SatsGuard compares a Bitcoin PSBT v0 with explicit payment intent, flags undeclared outputs and excessive supplied fees, and exports a redacted report. Inspection runs locally. It never signs, broadcasts, reads keys or contacts a chain API; a result is not approval to sign.

Download **satsguard-offline-app.zip**, extract the whole folder, and open **index.html**. No app installation or build is required. The ZIP includes the guide, 2m40s demo, captions, source snapshot, Git history and licenses. The MP4 and source ZIP are also separate assets.

The four synthetic testnet examples demonstrate recipient substitution, a fee-cap violation, missing input accounting and matching declared intent. Supplied input values, chain state, ownership and signatures remain unverified.

The original project was developed on October 5, 2026, in preparation for BOSS Battle and was not submitted there. This package is prepared for CodeStorm FutureForge evaluation. OpenAI Codex generated and reviewed code with the author's direction; the video uses synthetic narration. The project is a deterministic inspector, with no AI inference or payment integration.

Original source: MIT. Protocol parsing: bitcoinjs-lib 7.0.1. Build tooling: Vite 7.3.6. Dependency licenses are included. SHA-256 checksums and the package manifest accompany the assets.

This is a downloadable offline demo. The existing GitHub Pages address currently routes through the account's custom domain and returns 404; it is not a working live-demo URL.
"""


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def git_output(*args):
    result = subprocess.run(
        ["git", "-C", str(ROOT), *args], capture_output=True, text=True, check=True
    )
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--publication", type=Path, default=ROOT / "publication")
    parser.add_argument("--output", type=Path, default=ROOT / "output/release-assets")
    args = parser.parse_args()
    publication = args.publication.resolve()
    output = args.output.resolve()
    if output == publication or publication in output.parents:
        parser.error("Output must be separate from the publication folder.")
    for folder, names in ((ROOT, SOURCE_FILES), (publication, PUBLICATION_FILES)):
        for name in names:
            path = folder / name
            if not path.is_file() or path.is_symlink():
                parser.error(f"Missing regular input file: {name}")
    html = (publication / "index.html").read_text()
    if '<script type="module"' not in html or 'src="/assets/' in html:
        parser.error("Run npm run standalone first; index.html must contain its app code.")
    output.mkdir(parents=True, exist_ok=True)

    # Explicit allowlists keep credentials, caches and local work output out.
    source_archive = output / "satsguard-source.zip"
    with ZipFile(source_archive, "w", ZIP_DEFLATED) as archive:
        for name in SOURCE_FILES:
            archive.write(ROOT / name, "satsguard/" + name)
    app_archive = output / "satsguard-offline-app.zip"
    with ZipFile(app_archive, "w", ZIP_DEFLATED) as archive:
        archive.writestr("satsguard/START-HERE.txt", START_HERE)
        for name in PUBLICATION_FILES:
            archive.write(publication / name, "satsguard/" + name)
        archive.write(source_archive, "satsguard/satsguard-source.zip")
    for archive_path in (source_archive, app_archive):
        with ZipFile(archive_path) as archive:
            corrupt = archive.testzip()
            if corrupt:
                raise RuntimeError(f"Invalid ZIP entry: {corrupt}")
    for name in SEPARATE_ASSETS:
        shutil.copyfile(publication / name, output / name)
    (output / "release-notes.md").write_text(RELEASE_NOTES)

    asset_names = ["satsguard-offline-app.zip", "satsguard-source.zip", *SEPARATE_ASSETS]
    manifest = {
        "project": "SatsGuard",
        "format": "offline download; no live hosting",
        "sourceBaseCommit": git_output("rev-parse", "HEAD"),
        "modifiedTrackedSourceFiles": git_output("diff", "HEAD", "--name-only").splitlines(),
        "sourceSnapshot": "Current working files in the explicit source allowlist",
        "sourceFiles": list(SOURCE_FILES),
        "assets": [
            {"file": name, "bytes": (output / name).stat().st_size,
             "sha256": digest(output / name)}
            for name in asset_names
        ],
    }
    (output / "package-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    checksum_names = [*asset_names, "package-manifest.json"]
    (output / "SHA256SUMS.txt").write_text("".join(
        f"{digest(output / name)}  {name}\n" for name in checksum_names
    ))
    print(json.dumps({"output": str(output), "assets": manifest["assets"],
                      "sourceBaseCommit": manifest["sourceBaseCommit"]}, indent=2))


if __name__ == "__main__":
    main()
