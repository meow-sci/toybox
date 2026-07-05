<script lang="ts">
  import { app } from '../lib/toybox.svelte.ts'
  import { formatDate } from '../lib/format.ts'

  let adoptError = $state<string | null>(null)

  $effect(() => {
    if (app.grant?.manifestSync) void app.refreshManifestState()
  })

  async function adopt(folderIndex: number) {
    adoptError = await app.adopt(folderIndex, 0)
  }
</script>

<div class="installed">
  <div class="toolbar">
    <h3>Managed mods</h3>
    <button class="small" disabled={app.scanning} onclick={() => app.rescan()}>
      {app.scanning ? 'Scanning…' : 'Rescan folder'}
    </button>
  </div>

  {#if app.installed.length === 0}
    <p class="muted">Nothing managed yet — install something from Browse, or adopt a manual install below.</p>
  {/if}

  {#each app.installed as mod (mod.id)}
    {@const update = app.updateAvailable(mod)}
    {@const verify = app.verifyResults[mod.id]}
    {@const managedScan = app.scan?.managed.find((m) => m.installed.id === mod.id)}
    <div class="card row-card">
      <div class="main">
        <div class="title">
          <strong>{mod.id}</strong>
          <span class="muted">v{mod.version}</span>
          {#if mod.origin === 'adopted'}<span class="tag" title="Taken over from a manual install after exact content verification">adopted</span>{/if}
          {#if mod.autoInstalled}<span class="tag" title="Installed automatically as a dependency">dependency</span>{/if}
          {#if update}<span class="badge warn">update available: {update}</span>{/if}
          {#if managedScan && managedScan.status !== 'ok'}
            <span class="badge bad" title={managedScan.problems.join('\n')}>{managedScan.status}</span>
          {/if}
          {#if app.grant?.manifestSync}
            {@const enabled = app.manifestEnabled[mod.id.toLowerCase()] ?? true}
            <label class="toggle" title="Toggles the entry in the game's manifest.toml">
              <input
                type="checkbox"
                checked={enabled}
                onchange={() => app.setEnabled(mod.id, !enabled)}
              />
              enabled
            </label>
          {/if}
        </div>
        <div class="muted sub">
          {mod.files.length} files · installed {formatDate(mod.installedAt)}
          {#if verify}
            ·
            {#if verify.ok}
              <span class="badge good">verified ✓{verify.extra.length ? ` (+${verify.extra.length} user files)` : ''}</span>
            {:else}
              <span class="badge bad">
                {verify.modified.length} modified, {verify.missing.length} missing
              </span>
              <span class="muted">{[...verify.modified, ...verify.missing].slice(0, 4).join(', ')}</span>
            {/if}
          {/if}
        </div>
      </div>
      <div class="actions">
        {#if update}
          <button class="small primary" onclick={() => app.addInstall(mod.id)}>
            Upgrade → cart
          </button>
        {/if}
        <button class="small" onclick={() => app.verify(mod.id)}>Verify</button>
        <button class="small danger" onclick={() => app.addRemove(mod.id)}>Remove → cart</button>
        <button
          class="small"
          title="Stop managing without touching any files"
          onclick={() => app.forgetMod(mod.id)}
        >
          Forget
        </button>
      </div>
    </div>
  {/each}

  {#if app.scan && app.scan.foreign.length > 0}
    <h3>Found in your mods folder (not managed)</h3>
    {#if adoptError}
      <p class="badge bad">{adoptError}</p>
    {/if}
    {#each app.scan.foreign as entry, i (entry.folder)}
      <div class="card row-card">
        <div class="main">
          <div class="title">
            <strong>{entry.folder}/</strong>
            {#if entry.status === 'adoptable'}
              <span class="badge good">
                matches {entry.catalogMod?.id} {entry.candidates[0]?.release.version}
              </span>
            {:else if entry.status === 'recognized-modified'}
              <span class="badge warn">recognized as {entry.catalogMod?.id}, but content differs</span>
            {:else if entry.status === 'recognized-unverified'}
              <span class="badge warn">looks like {entry.catalogMod?.id} (no manifest to verify against)</span>
            {:else}
              <span class="badge info">unknown — toybox will not touch it</span>
            {/if}
          </div>
          <div class="muted sub">
            {entry.fileCount} files
            {#if entry.modToml?.name}· mod.toml: {entry.modToml.name} {entry.modToml.version ?? ''}{/if}
            {#if entry.status === 'recognized-modified' && entry.candidates[0]}
              · differs from {entry.candidates[0].release.version}:
              {[...entry.candidates[0].changedFiles, ...entry.candidates[0].missingFiles, ...entry.candidates[0].extraFiles].slice(0, 4).join(', ')}
            {/if}
          </div>
        </div>
        <div class="actions">
          {#if entry.status === 'adoptable'}
            <button class="small primary" onclick={() => adopt(i)}>
              Adopt (verify checksums)
            </button>
          {:else if entry.catalogMod}
            <button
              class="small"
              title="Replace this folder with a clean managed install"
              onclick={() => app.addInstall(entry.catalogMod!.id)}
            >
              Reinstall cleanly → cart
            </button>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .toolbar h3 {
    margin: 8px 0;
  }
  .row-card {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 10px;
  }
  .main {
    flex: 1;
    min-width: 0;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sub {
    font-size: 12px;
    margin-top: 3px;
  }
  .actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .toggle {
    display: inline-flex;
    gap: 5px;
    align-items: center;
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
