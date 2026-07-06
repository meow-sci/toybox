# toybox 🧶

A mod manager for **Kitten Space Agency** that runs entirely in the browser.
No installer, no backend, no account: the app is a static page, your mods
folder is the database, and everything toybox knows lives in
`mods/.toybox/` on your own disk — wipe the browser, re-grant the folder,
nothing is lost.

**Read [PLAN.md](PLAN.md)** for the full design: the CKAN/StarMap/flexo
analysis it is built on, the index schema, the transactional install engine
and its crash-recovery model, the explainable dependency resolver, the
CORS/download strategy, and the community-governance model of the sibling
[toybox-index](https://github.com/meow-sci/toybox-index) repo.

## What it does

- **Browse & discover** the community index with fuzzy search; rich
  markdown readmes rendered in-app.
- **Transactional cart**: stage installs/upgrades/removals, review the exact
  plan (with dependency reasoning, sizes, and warnings), apply as one
  journaled transaction with crash recovery. Failed resolutions explain
  _why_ — every candidate version and the reason it was rejected.
- **Checksums everywhere**: artifacts are sha256-verified before extraction,
  every installed file's digest is recorded, `verify` re-checks integrity,
  and upgrades warn before touching files you edited.
- **Manual installs are first-class**: recognized folders can be _adopted_
  (exact content match), modified ones are flagged, unknown ones are listed
  and never touched.
- **Enable/disable** mods via the game's own `manifest.toml` (grant the
  `Kitten Space Agency` folder rather than just `mods/`).

Works in any modern browser. Direct install (and everything stateful —
verify, adopt, enable/disable) needs the File System Access API
(Chromium-based browsers); everywhere else toybox runs in **browse mode**:
full catalog, search, readmes, and dependency resolution, with the final
install replaced by a checksum-verified **.zip bundle download** of the
resolved selection — extract it into your `mods/` folder.

## Repo layout

```
PLAN.md           the design document
packages/core     @toybox/core — the headless package manager (no UI imports;
                  fully tested against an in-memory FS and against real OPFS
                  FileSystemDirectoryHandles in Chromium)
packages/app      @toybox/app — the Svelte 5 SPA driving the core facade
```

## Development

```bash
pnpm install
pnpm dev             # run the app (Vite)
pnpm lint            # oxlint
pnpm fmt             # oxfmt
pnpm typecheck       # tsc + svelte-check
pnpm test            # node unit/integration suites
pnpm test:browser    # engine tests on real FSA handles (headless Chromium)
pnpm build           # typecheck core + build the app
```

The browser suite uses the Playwright-managed Chromium; on systems with a
preinstalled one set `CHROMIUM_EXECUTABLE=/path/to/chrome`.

## License

MIT
