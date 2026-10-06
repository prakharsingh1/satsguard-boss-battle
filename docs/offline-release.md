# Offline release packaging

The current GitHub Pages deployment is built, but its default URL inherits the account user site's `getsutra.me` custom domain. The project path reaches a Railway 404. Clearing this project's custom domain will not help: it is already `null`. No account domain, DNS or other repository changes are needed to distribute an offline release.

A GitHub Release provides an ordinary public repository download page, independent of Pages routing. This stays within the existing repository and MIT publication scope. It is an offline evaluation artifact; confirm that the event accepts this format before treating it as sufficient for any live-demo requirement. A release is not a hackathon submission receipt.

## Prepare and verify locally

After updating project descriptions, rebuilding the standalone app and completing app checks, run from the repository root:

```sh
npm run standalone
python3 scripts/package-release.py
cd output/release-assets
shasum -a 256 -c SHA256SUMS.txt
```

The script performs no network calls and uploads nothing. It creates `output/release-assets/satsguard-offline-app.zip`, containing the full publication folder plus `START-HERE.txt` and a fresh source snapshot. It stages the video, SRT/VTT captions, source ZIP, existing history bundle, checksum file, manifest and reviewable release notes beside it. Explicit file allowlists exclude credentials, node_modules, Git configuration and private output.

The source snapshot records its base Git commit and any modified tracked files. Commit final source changes, regenerate the actual Git history bundle, rebuild and rerun packaging before publishing a release against that commit. The package does not regenerate the history bundle or copy a stale publication source archive.

Extract the offline ZIP into a clean temporary directory, open its `index.html`, try all four fixtures and play the included MP4. File-scheme restrictions may prevent HTML video captions loading in some browsers; the separate SRT can be loaded into a local player. Validate this extracted copy, not just the build directory.

## Publication command for review

The following is a template only. Resolve the final published commit and choose an unused tag before running it. Do not run this command until the root task chooses to publish the release.

```sh
gh release create v0.2.0-codestorm \
  --repo prakharsingh1/satsguard-boss-battle \
  --target FINAL_PUBLISHED_COMMIT_SHA \
  --title 'SatsGuard — CodeStorm offline evaluation package' \
  --notes-file output/release-assets/release-notes.md \
  --latest=false \
  output/release-assets/satsguard-offline-app.zip \
  output/release-assets/satsguard-source.zip \
  output/release-assets/satsguard-demo.mp4 \
  output/release-assets/satsguard-demo.srt \
  output/release-assets/satsguard-demo.vtt \
  output/release-assets/satsguard-history.bundle \
  output/release-assets/package-manifest.json \
  output/release-assets/SHA256SUMS.txt
```

`--target` pins automatic tag creation to the reviewed commit. Do not allow the CLI to choose a newer default-branch commit implicitly. Do not replace existing release assets or tags. Record the returned release URL, read back its assets, download the app ZIP anonymously and check its checksum before using that URL in a submission. This operation publishes in the existing GitHub repository; it does not create another hosting account or accept new provider terms.

Official references: [GitHub domain inheritance](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages), [about releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), [release links](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases), and [gh release create](https://cli.github.com/manual/gh_release_create).
