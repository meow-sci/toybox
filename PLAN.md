# toybox — a bespoke, browser-only mod manager for Kitten Space Agency

toybox is a package manager for KSA mods that runs entirely in the browser as a
static SPA (GitHub Pages), installs and manages mods directly on the player's
disk through the File System Access API, and is fed by a community-governed
metadata index (the sibling repo **meow-sci/toybox-index**). No installer, no
backend, no cloud storage, no localStorage state: wipe your browser, re-grant
the folder, and everything toybox knows is still there — because it lives in
`mods/.toybox/` on your disk.

This document is the design record: what was learned from the prior art (CKAN,
StarMap, flexo), the decisions taken, the schemas, the safety model, the
governance model, and the roadmap. The initial implementation described here is
built in this repo (`packages/core` + `packages/app`) and in toybox-index.

---

## 1. Prior-art analysis (what we learned, what we reject)

### 1.1 CKAN (the KSA fork of the KSP mod manager)

CKAN's core mechanisms, from a deep read of `CKAN-KSA`:

- **File tracking.** CKAN's registry (`registry.json`) records, per installed
  module, the set of relative file paths it wrote plus a reverse index
  `installed_files: path → owning module`. Ownership is how CKAN distinguishes
  managed files from user files: anything without an entry is user-owned and
  never touched. **However — `InstalledModuleFile` is an empty class: CKAN
  stores no per-file checksum.** It cannot tell a user-edited file from a
  pristine one; overwrite prompts compare live against the zip stream.
- **Transactions.** Installs/upgrades/uninstalls run inside a .NET
  `TransactionScope` with ChinhDo's `TxFileManager` journaling file ops and the
  registry enlisting as a transactional resource. Upgrade = remove-then-add in
  one transaction.
- **Install stanzas.** `.ckan` metadata maps archive content to destinations
  via `install` directives (`file`/`find`/`find_regexp`, `install_to`, `as`,
  filters). Powerful, but a large ambiguity surface; for KSA the fork only
  supports the `mods` destination anyway.
- **Dependency model.** `depends/recommends/suggests/conflicts/supports`,
  virtual modules via `provides`, min/max version bounds. The infamous UX
  failures live exactly here: `TooManyModsProvideKraken` (ambiguous virtual
  providers surfaced to users as a raw choice about mods they never asked for)
  and deep `DependenciesNotSatisfiedKraken` chains. The fork added typed
  rejection reasons and ancestor-chain reconstruction (`PrependAncestors`) —
  evidence that explainability was bolted on after the fact.
- **KSA specifics in the fork.** Mods live _outside_ the game dir in
  `<Documents>/My Games/Kitten Space Agency/mods/` (survives game updates);
  KSA versions are `year.month.buildcounter.revision` where the **build
  counter is per-machine noise and must be normalized to 0** for all
  comparisons; the game reads `manifest.toml` (flat `[[mods]]` entries with
  `id` + `enabled`) to decide which mod folders are active, and CKAN syncs it
  carefully (never flips existing `enabled`, round-trips unknown keys, only
  prunes entries it added); auto-detected ("AD") manual installs satisfy any
  version bound and can't be upgraded.

**What toybox keeps:** exact file-ownership tracking; never touching unowned
files; empty-dir pruning; remove-then-add upgrades; the manifest.toml sync
discipline; KSA build-counter normalization; download-hash verification.

**What toybox rejects / improves:**

1. **No per-file checksums → toybox records `sha256 + size` for every file it
   writes.** This enables: real integrity verification, detection of
   user-modified files _before_ an upgrade clobbers them, and adoption of
   manual installs by exact content match.
2. **Opaque conflict errors → explainable resolution.** Every requirement edge
   carries "who demanded this and why"; failures render as a complete
   derivation (every candidate version and the reason it was rejected),
   cargo/pubgrub-style, not a dead-end exception. There are no virtual
   modules/`provides` in the model at all — the largest single source of
   CKAN's ambiguity simply doesn't exist. (StarMap has no such concept either;
   if the ecosystem ever needs it, it arrives with explicit UI-driven choice,
   never resolver guessing.)
3. **Install stanzas → convention.** A toybox artifact is a zip containing one
   top-level mod folder (exactly what purrTTY/gatOS release CI already
   produces). The index records `root` (folder inside the zip) and `installAs`
   (folder under `mods/`, which must equal the StarMap ModId). No mapping
   language, no zero-match stanzas, no ambiguity.
4. **One giant registry JSON rewritten wholesale with a live-object
   transaction backup → small state file + explicit journal** with crash
   recovery designed for a platform (the browser) that has no filesystem
   transactions at all (§4).

### 1.2 StarMap (the KSA mod loader) — the ground truth toybox must match

- **Identity is the folder name.** `folder name == KSA manifest id ==
mod.toml `name` == StarMap ModId`. Everything in toybox keys on this string.
- **StarMap is 100% version-agnostic.** `[[StarMap.ModDependencies]]` entries
  are `(ModId, Optional, ImportedAssemblies)` — no version constraints exist
  at load time. toybox's index owns the entire version model; at runtime only
  presence/absence matters.
- **Required vs optional is a real semantic.** Required-missing → the mod
  silently never loads. Optional-missing → loads fine (guards internally).
  Optional-_present_ shares assemblies from the provider's ALC (one Assembly →
  one Type identity → shared statics), so a _wrong version_ of an optional
  dependency is a real failure mode. Hence toybox's rule: **optional deps are
  never auto-installed, but when present their version range is validated**
  (violations surface as warnings).
- **Required-dependency cycles are silently dropped by the loader** (fixed-
  point iteration never satisfies them). toybox's resolver rejects them with
  an explanation instead.
- **Enable/disable is KSA's `manifest.toml`**, not a StarMap concept. toybox
  manages it when granted the KSA folder (§5).
- StarMap's own remote-repository/downloader (`StarMap.Launcher`) is
  commented-out aspirational code — there is no existing protocol to conform
  to; toybox's index is greenfield.

### 1.3 flexo (the proven browser/FSA tech stack)

toybox reuses flexo's architecture wholesale, swapping React for Svelte 5:

- Vite 8 (Rolldown-native) + TypeScript + oxlint + oxfmt + pnpm, exact-pinned
  deps, `base` set for Pages, two-job Pages deploy workflow with
  `VITE_BUILD_ID: github.sha`.
- The FSA grant pattern: persist the `FileSystemDirectoryHandle` in IndexedDB
  (it is structured-cloneable), passively `queryPermission` on boot (never
  prompt on load), `requestPermission` only from a user gesture, expose a
  4-state status (`unsupported / none / needs-permission / ready`).
  _Note: the IndexedDB handle is a reconnection convenience only — zero state
  lives in the browser; losing it just means re-picking the folder._
- Hard "no UI imports in domain code" separation — in toybox this is a real
  package boundary (`@toybox/core` has no Svelte anywhere).

---

## 2. System overview

```
meow-sci/toybox-index (GitHub repo)                meow-sci/toybox (this repo)
┌──────────────────────────────────┐               ┌──────────────────────────────┐
│ mods/<id>/mod.toml    (identity) │   compile     │ packages/core  @toybox/core  │
│ mods/<id>/README.md   (rich md)  │   (CI, on     │   headless engine, no UI     │
│ mods/<id>/releases/<v>.toml      │    merge)     │ packages/app   @toybox/app   │
│ CODEOWNERS (generated)           │──────────────►│   Svelte 5 SPA               │
│ .github/workflows                │  GitHub Pages │        │ GitHub Pages        │
│   validate.yml  (PR gate)        │  v1/index.json│        ▼                     │
│   publish.yml   (build index)    │  v1/manifests/│  player's browser (Chromium) │
└──────────────────────────────────┘       ▲       └───────────┬──────────────────┘
                                           │ fetch index       │ File System Access API
            mod authors' GitHub releases ──┼───────────────────▼
            (zips; sha256 digests)         │       <Documents>/My Games/
                                    fetch artifacts    Kitten Space Agency/
                                    (API endpoint /      manifest.toml   ← enable/disable sync
                                     local-file          mods/<ModId>/…  ← installs
                                     fallback)           mods/.toybox/   ← ALL toybox state
```

Three trust boundaries, each verified:

1. **index → app**: schema-validated on parse; every artifact carries a sha256
   published at PR-validation time.
2. **artifact → disk**: the artifact digest is verified _before_ extraction
   ever starts, and every extracted file is hashed while streaming and checked
   against the per-file manifest CI generated from the same bytes. Nothing
   unverified touches the mods folder.
3. **disk → state**: every managed file's `path/size/sha256` is recorded, so
   verify/adopt/upgrade decisions are content-based, never guesses.

---

## 3. The index (toybox-index repo)

### 3.1 Source layout — one folder per mod, built for CODEOWNERS-style self-governance

```
toybox-index/
  mods/
    purrtty/                         ← folder name: lowercase slug (PR routing unit)
      mod.toml                       ← identity, owners, tags, links
      README.md                      ← rich markdown, rendered in the app
      releases/
        1.1.0.toml                   ← one file per release (append-only in practice)
        1.0.1.toml
    gatos/
      …
  CODEOWNERS                         ← generated from mods/*/mod.toml owners
  scripts/                           ← validate + compile (TypeScript, run by Node 24)
  .github/workflows/validate.yml     ← PR gate (schema, digests, ownership, auto-merge)
  .github/workflows/publish.yml      ← compile → GitHub Pages (v1/index.json + manifests)
```

`mods/<slug>/mod.toml`:

```toml
id = "purrTTY"                # canonical StarMap ModId == install folder name
name = "purrTTY"
summary = "A terminal emulator for KSA with mostly VT100/xterm compatibility"
authors = ["Alex Sherwin"]
license = "MIT"
repository = "https://github.com/meow-sci/purrtty"
tags = ["terminal", "utility"]
owners = ["alex-sherwin"]     # GitHub logins allowed to self-publish releases
# max_artifact_bytes = 209715200   # opt-in ceiling for mods shipping > 50 MiB
```

`mods/<slug>/releases/<version>.toml`:

```toml
version = "1.1.0"
channel = "stable"            # or "prerelease"
published = "2026-07-04T16:21:00Z"
# ksa = ">=2026.7"            # optional game-compat range (build counter ignored)
# notes = "…markdown…"        # optional release notes

# [[dependencies]]            # optional; maps 1:1 onto StarMap semantics + a range
# id = "purrTTY"
# range = "^1.0"
# optional = true

[[artifacts]]
key = "universal"             # or "windows"/"linux" for platform-split releases
platforms = ["*"]             # "*" | ["windows", "linux", "macos"]
url = "https://github.com/meow-sci/purrtty/releases/download/v1.1.0/purrTTY-1.1.0.zip"
size = 24367747
sha256 = "331b3ab82b669f45417cc74c6e55593727c8e12b0db83f8dc2f6acc232c2e4b0"
root = "purrTTY"              # top-level folder inside the zip
# installAs defaults to the mod id
```

### 3.2 Compiled output — what the app actually fetches

CI compiles the TOML tree into:

- **`v1/index.json`** — everything (identity, readmes inlined, releases,
  dependencies, artifacts with digests + GitHub API asset URLs) _except_
  per-file manifests. One fetch renders the whole catalog. Schema-versioned
  (`schema: 1`); breaking changes ship as `v2/` alongside `v1/`.
- **`v1/manifests/<slug>/<version>.<artifactKey>.json`** — the per-file
  manifest of each artifact (`path/size/sha256` per file), generated by CI by
  downloading the artifact once, verifying its digest, and walking the zip.
  Fetched on demand at install/adopt/verify time.

Published to GitHub Pages. The app is hosted on the same origin
(`meow.science.fail/toybox/` vs `…/toybox-index/`), so index fetches are
same-origin; Pages also serves `Access-Control-Allow-Origin: *` for other
consumers.

**The enrichment step is load-bearing, not cosmetic** (CKAN's NetKAN plays the
same role): publishers author ~15 lines of TOML; CI is what turns that into
verified digests + file manifests. GitHub now exposes a `digest` field on
release assets, which validation cross-checks against the author-declared
sha256 — a supply-chain guard for free.

### 3.3 Governance — hundreds of publishers, none of them org members

GitHub constraint discovered up front: **CODEOWNERS entries only gate reviews
for users with write access**, so path-based code ownership alone cannot give
non-org publishers merge rights. toybox-index therefore implements the
"CODEOWNERS pattern" as data + automation:

- `owners` in each mod's `mod.toml` is the authoritative per-path owner list
  (any GitHub login — no org membership needed).
- `CODEOWNERS` is _generated_ from those files (kept for review-routing of the
  admin team and as a human-readable ownership map).
- **validate.yml** (the PR gate) checks every PR:
  1. schema-validity of all changed TOML + README files;
  2. changed paths are confined to `mods/<slug>/**` (index scripts/workflows
     require the admin team);
  3. artifact URLs resolve and their sha256 matches both the declared value
     and GitHub's asset digest; file manifests are generated and attached;
  4. `installAs`/`root`/id consistency (the zip's top-level folder is the
     ModId), dependency ids exist, versions parse, no duplicate release;
  5. **ownership**: the PR author is in the _base branch's_ `owners` for every
     touched mod (reading owners from the base branch means a PR cannot grant
     itself ownership).
- **Auto-merge**: when a PR touches only existing mods the author owns and
  validation is green, the workflow approves and merges it — publishers
  self-publish with zero admin involvement. New-mod registrations (a PR
  creating `mods/<slug>/`), any `owners` change, and any `max_artifact_bytes`
  change require a review from the toybox admin team (the generated
  CODEOWNERS routes it).
- **Artifact size policy (dynamic, per registration)**: artifacts default to
  a **50 MiB** ceiling. Mods that genuinely ship more (gatOS bundles QEMU +
  an Alpine image: ~100–145 MB) declare `max_artifact_bytes` in their
  mod.toml — a registration-level setting a release PR cannot raise on
  itself (changes are admin-reviewed, like owners changes). An absolute
  2 GiB hard cap overrides all metadata, and the CI downloader aborts any
  stream the moment it exceeds the declared size, so neither false size
  claims nor over-sending servers can make CI buffer unbounded data.

This is Homebrew-style community operation: the small team owns the rails,
thousands of publishers own their folders.

### 3.4 Convention over configuration

- Release zips **already** match the convention (purrTTY/gatOS CI does
  `zip -r <name> <ModId>`): one top-level `<ModId>/` folder. `root`/`installAs`
  exist for the rare exception, defaulted otherwise.
- `channel` defaults to `stable`; `platforms` defaults to all; `installAs`
  defaults to `id`; `range` defaults to `*`.
- A future `sync` helper (roadmap) can draft a release TOML straight from a
  GitHub release URL — the digest and size come from the API.

---

## 4. The install engine (@toybox/core) — safety model

### 4.1 State on the player's disk (the _only_ state)

```
mods/.toybox/
  state.json       { schema, mods: { [id]: { version, installDir, installedAt,
                     autoInstalled, origin: 'index'|'adopted',
                     source: { url, sha256 },
                     files: [{ path, size, sha256 }] } },
                     manifestOwned: [ids toybox added to manifest.toml] }
  settings.json    channel, ksaVersion, githubToken?, indexUrl?
  journal.json     present ONLY during a transaction (crash recovery)
  staging/<txId>/  transaction workspace
```

### 4.2 Transactions without filesystem transactions

The browser has no atomic multi-file operations, so safety comes from
ordering + a journal (all implemented in `packages/core/src/install/transaction.ts`):

1. **STAGE** — for each install: acquire the artifact, verify its sha256
   **before extraction begins**, then stream-extract into
   `.toybox/staging/<txId>/` hashing every file as it is written and checking
   each against the CI-generated per-file manifest. The live tree is
   untouched; any failure here = sweep staging, done.
2. **JOURNAL** — write the complete apply plan (every step, every staged
   file's `path/size/sha256`, every replaced version's file list) and flip the
   journal to `applying`. This is the point of no return.
3. **APPLY** — per step: delete the replaced/removed version's _recorded_
   files (never anything else; empty dirs pruned; a mod folder that still
   contains user files survives), then promote staged files into place,
   deleting each from staging after its copy (making recovery a trivial
   "copy what remains").
4. **COMMIT** — write `state.json`, clear the journal, sweep staging, sync
   `manifest.toml`.

**Crash recovery** (runs on every open): a `staging`-phase journal is swept
(nothing was touched — "cleaned up, nothing changed"); an `applying`-phase
journal is **rolled forward** idempotently from the journal's own data (old
files are already partially gone; forward is the only consistent direction).

### 4.3 The cart is the unit of change

The UI stages intents (install X, upgrade Y, remove Z) into a cart; `plan()`
resolves the whole cart plus the installed set into one reviewable
transaction — the diff (installs/upgrades/downgrades/removals with reasons),
download sizes, and warnings (unmanaged-folder collisions, user-modified files
that an upgrade/remove would destroy, optional-dep version skew). Apply is
all-or-nothing per the model above. Nothing is fetched or written before the
user has seen the full plan.

### 4.4 Downloads — the CORS reality

Verified empirically: `browser_download_url` on github.com is **not**
CORS-fetchable (the 302 carries no ACAO header). Acquisition is therefore a
strategy chain (`install/download.ts`):

1. **GitHub API asset endpoint** (`api.github.com/…/releases/assets/:id`,
   `Accept: application/octet-stream`; ACAO `*`) — the index compiles the
   asset id in as `apiUrl`. Unauthenticated rate limits (60/h/IP) are fine for
   installs; a settings-provided PAT lifts them.
2. **Direct fetch** — works for any CORS-enabled host (e.g. Pages-hosted
   artifacts), and future-proofs against GitHub changes.
3. **Local-file fallback (guaranteed path)** — the app opens the release URL
   in a new tab (a plain navigation download, no CORS involved) and the user
   hands the file to toybox, which verifies its sha256 exactly like a fetched
   one. Because every artifact is content-addressed, a user-supplied file is
   precisely as trustworthy as a direct download.

Downloads stream through an incremental sha256 (`@noble/hashes`) into a Blob
(browsers disk-back large blobs; gatOS is ~140 MB), and extraction streams
from the Blob through fflate with backpressure — memory stays bounded and
per-file digests are computed as bytes are written.

### 4.5 Manual installs — embrace, don't fight

`scan()` reconciles disk vs state vs index:

- **managed** folders are re-checked against their recorded file lists
  (existence + size cheaply; full sha256 via `verify()`);
- **foreign** folders with a `mod.toml` are matched against the index (by
  folder name / mod.toml `name`) and against release file manifests by
  path+size → `adoptable` (exact match), `recognized-modified` (recognized but
  content differs — warned, listed per-file), `recognized-unverified` (no
  manifest available), or `unknown` (listed, never touched);
- **adoption** hashes every file and takes over management only on an exact
  content match — from then on the folder upgrades/removes like any managed
  install. CKAN's AD modules satisfy any version blindly; toybox adoption is
  content-proven to a specific release.

### 4.6 KSA manifest.toml

With a KSA-root grant, toybox syncs `manifest.toml` after every transaction
(new folders added enabled; entries toybox added — tracked in
`state.manifestOwned` — pruned when their folder goes; existing `enabled`
flags never flipped; unknown keys round-tripped), and exposes per-mod
**enable/disable** in the UI — a capability CKAN-class managers don't surface.

---

## 5. Dependency & version model

- **Mod versions:** SemVer 2.0 with cargo/npm range grammar (`^`, `~`,
  comparators, `||`, wildcards, hyphen ranges). Prereleases follow the npm
  anchoring rule and are additionally gated by the user's channel setting
  (purrTTY/gatOS tip builds are `0.1.0-tip.<stamp>` — they slot in naturally).
- **Game versions:** `year.month.build.revision` with the build counter
  normalized to 0 (per the CKAN-KSA discipline); releases may declare a `ksa`
  range; the app's known game version (user-set; auto-detection on the
  roadmap) gates eligibility with explicit "requires KSA ≥…, you have …"
  rejections.
- **Resolution:** one version per ModId (the loader's reality), exhaustive
  backtracking newest-first over eligible candidates (platform + ksa + channel
  filtered), honoring declared `conflicts` in both directions. Deterministic:
  same index + same request → same answer.
- **Explainability is the contract:** a failure returns every candidate
  considered and why each fell (version constraint + who imposed it, platform,
  game version, conflict + declared reason, or the flattened derivation of the
  nested requirement that made it unsolvable). The UI renders this directly;
  there is no "resolution failed" without a complete why.
- **Optional deps:** never auto-installed; version-validated when present
  (warning, not error — matching StarMap's load-anyway behavior while
  surfacing the assembly-sharing hazard).
- **Auto-installed bookkeeping:** dependencies pulled in automatically are
  flagged and garbage-collected when the last dependent goes (shown in the
  plan as "no longer required").

---

## 6. The app (@toybox/app) — Svelte 5

Same core tech as flexo, React swapped for Svelte 5 (runes):
Vite 8 (Rolldown) · TypeScript strict · oxlint · oxfmt · pnpm · exact pins ·
GitHub Pages deploy with `base: '/toybox/'`.

Structure: `@toybox/core` is the entire brain (headless, tested); the app is a
thin driver around the `Toybox` facade (`open() → refreshIndex() → search()/
scan() → plan() → apply()`), holding UI state in runes-based stores:

- **Grant flow** — pick the `Kitten Space Agency` folder (full features) or
  the `mods` folder (manifest sync disabled, with a hint); IndexedDB handle
  persistence + passive re-query + gesture re-grant (flexo's pattern).
- **Browse** — the full catalog with fuzzy search (fzf-style scorer in core:
  boundary/camel bonuses, weighted fields id > name > tags > summary >
  authors), tag chips, installed/update badges.
- **Mod detail** — README markdown rendered client-side (marked + DOMPurify,
  hardened: no raw HTML pass-through, links `rel=noopener`), release list with
  channel/compat/platform info, per-version install.
- **Cart & review** — staged changes; the plan view shows the diff with
  reasons, sizes, warnings (each requiring explicit acknowledgment when
  destructive) — and resolution failures render the derivation tree.
- **Apply** — per-mod progress (download bytes, per-file extraction), the
  local-file fallback dialog when the network path fails, recovery banners.
- **Installed** — versions, origin (installed/adopted), enable/disable
  (manifest.toml), verify (full-hash), update-available, remove, forget.
- **Scan results** — adoptable folders (one-click adopt), recognized-modified
  (per-file diff), unknown folders (listed, untouched).
- **Settings** — channel, KSA version, GitHub token, index URL override.

UI is deliberately minimal-clean for this pass; the control points it drives
are the durable interface.

## 7. Testing

- **Unit/integration (node):** every core module — semver/ksa-version
  grammars, fuzzy scoring, manifest round-trip/sync, zip streaming (nested
  paths, chunk boundaries, zip-slip rejection, corrupt-stream detection via
  declared-size enforcement), download strategies (API-first, checksum-refusal
  fail-closed, token, progress), resolver (deps, optionals, conflicts,
  backtracking, upgrades, orphan GC, blocked removals, explanation content),
  transaction engine (install/upgrade/remove file exactness, user-file
  preservation, unmanaged-collision refusal, manifest verification,
  **crash-recovery for both journal phases**), scanner/adoption/verify
  (including same-size tamper caught only by hashes), and the full Toybox
  facade lifecycle over the in-memory FS with a stubbed network — including
  browser-wipe survival (fresh instance over the same tree).
- **Browser e2e (vitest browser mode, real Chromium via Playwright):** the
  same engine driven against **real FileSystemDirectoryHandle objects (OPFS)**
  — real streaming writables, real `removeEntry`, real handle semantics — plus
  fetch-stubbed end-to-end install/upgrade/remove/recovery flows and app store
  logic. OPFS gives the genuine FSA API surface without permission prompts.
- **CI:** lint + typecheck + node tests + browser tests + build, on every PR;
  Pages deploy on main.

## 8. Security posture

- Content addressing end-to-end: artifact sha256 published at index-merge
  time (cross-checked against GitHub's own asset digest), verified before
  extraction; per-file sha256 manifests verified during extraction; adoption
  only on proven content.
- Zip-slip defense (path traversal, absolute paths, drive letters rejected);
  declared-size enforcement catches truncated/corrupt deflate streams.
- Size caps at every layer: 50 MiB default per artifact, per-registration
  `max_artifact_bytes` override (admin-reviewed, 2 GiB absolute maximum), and
  hard stream aborts — both CI and the in-browser downloader cancel a
  download the instant it exceeds the published size, and the local-file
  fallback rejects wrong-sized files before hashing.
- The index is data, never code; readmes are sanitized before rendering.
- The app never asks for credentials except the optional PAT (stored only in
  `.toybox/settings.json` on the user's own disk).
- Chromium-only by dependency on FSA (`showDirectoryPicker`); a clear
  unsupported-browser screen otherwise.

## 9. Roadmap (post-initial-pass)

- **Index `sync` tool**: draft a release TOML from a GitHub release URL.
- **KSA version auto-detection** (read `Content/Versions/*.json` on an
  optional game-dir grant, as CKAN's `KsaBuildVersionProvider` does).
- **Artifact caching** in OPFS keyed by sha256 (re-install/downgrade without
  re-download; cache is content-addressed so eviction is trivial).
- **Layouts/profiles**: named mod-sets (mirroring purrTTY's layout concept),
  export/import as JSON.
- **Delta-aware upgrades**: skip promoting files whose sha256 is unchanged
  between versions (gatOS ships ~90 MB of QEMU that rarely changes).
- **Signed index snapshots** (minisign/sigstore) if the threat model grows
  beyond GitHub org trust.
- **`ExportedAssemblies`/`ImportedAssemblies` surfacing**: show the
  assembly-sharing graph, warn on known-incompatible ABI pins.
- **Multi-index federation** (third-party indexes with per-index trust UI).

## 10. Decisions log (short form)

| #   | Decision                                                      | Why                                                                        |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Identity = StarMap ModId = folder name                        | Loader ground truth                                                        |
| 2   | Index owns versioning; SemVer + cargo ranges                  | StarMap is version-agnostic; proven grammar                                |
| 3   | No `provides`/virtual modules                                 | CKAN's worst ambiguity source; no loader counterpart                       |
| 4   | Optional deps: never auto-install, validate when present      | Exact StarMap semantics + ALC sharing hazard                               |
| 5   | Per-file sha256 in state                                      | CKAN's biggest tracking gap                                                |
| 6   | Stage→journal→apply with roll-forward recovery                | No FS transactions in browsers                                             |
| 7   | Verify artifact digest **before** extraction                  | Never write unverified bytes                                               |
| 8   | CI-generated per-file manifests in the index                  | Enables adoption, verify, tamper detection                                 |
| 9   | TOML sources, compiled JSON index                             | Human-friendly authoring (KSA ecosystem is TOML), one-fetch runtime        |
| 10  | owners-file + validation-bot auto-merge; generated CODEOWNERS | GitHub can't grant merge to non-members via CODEOWNERS                     |
| 11  | GitHub API asset endpoint as primary download path            | browser_download_url is not CORS-fetchable (verified)                      |
| 12  | Local-file fallback as guaranteed install path                | Content addressing makes it equally trustworthy                            |
| 13  | Grant KSA root (or mods dir)                                  | manifest.toml lives beside mods/ → enable/disable support                  |
| 14  | All state in `mods/.toybox/`                                  | Hard requirement: ephemeral app, durable disk                              |
| 15  | KSA build counter normalized to 0                             | Non-monotonic per-machine noise (CKAN-KSA discipline)                      |
| 16  | 50 MiB artifact cap, per-registration override, stream aborts | Self-protection for CI + players; a release PR can't raise its own ceiling |
