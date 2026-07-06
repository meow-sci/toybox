<script lang="ts">
  import { ALL_PLATFORMS } from '@toybox/core'
  import { app } from '../lib/toybox.svelte.ts'
  import { formatBytes } from '../lib/format.ts'

  let { onclose }: { onclose: () => void } = $props()
  let acknowledgeWarnings = $state(false)

  const hasUnmanagedOverwrite = $derived(
    app.planned?.plan.operations.some((op) => op.kind !== 'remove' && op.overwritesUnmanaged) ??
      false,
  )
  const needsAck = $derived((app.planned?.warnings.length ?? 0) > 0 || hasUnmanagedOverwrite)
</script>

<div class="drawer card">
  <div class="head">
    <h3>Transaction cart</h3>
    <button class="small" onclick={onclose}>✕</button>
  </div>

  {#if app.cartSize === 0 && !app.applyDone && !app.bundleDone}
    <p class="muted">
      {#if app.mode === 'catalog'}
        Empty. Stage mods here, review the resolved selection, then download everything as one
        verified .zip.
      {:else}
        Empty. Stage installs, upgrades, and removals here, review the full plan, then apply them
        as one transaction.
      {/if}
    </p>
  {:else}
    <ul class="items">
      {#each app.cartInstall as item (item.id)}
        <li>
          <span class="badge info">install</span>
          {item.id}
          {item.version ? `@${item.version}` : '(latest)'}
          <button class="small" onclick={() => app.drop(item.id)}>drop</button>
        </li>
      {/each}
      {#each app.cartRemove as id (id)}
        <li>
          <span class="badge bad">remove</span>
          {id}
          <button class="small" onclick={() => app.drop(id)}>drop</button>
        </li>
      {/each}
    </ul>

    {#if app.mode === 'catalog' && app.cartInstall.length > 0}
      <div class="platform-row">
        <label for="bundle-platform">Bundle for</label>
        <select
          id="bundle-platform"
          value={app.platform}
          onchange={(e) => app.setPlatform(e.currentTarget.value as (typeof ALL_PLATFORMS)[number])}
        >
          {#each ALL_PLATFORMS as p (p)}
            <option value={p}>{p}</option>
          {/each}
        </select>
      </div>
    {/if}

    {#if app.mode === 'catalog'}
      {#if !app.catalogPlan && !app.planFailure && app.cartInstall.length > 0}
        <button class="primary" onclick={() => app.buildCatalogPlan()}>Review selection</button>
      {/if}
    {:else if !app.planned && !app.planFailure && app.cartSize > 0}
      <button class="primary" disabled={app.planning} onclick={() => app.buildPlan()}>
        {app.planning ? 'Resolving…' : 'Review plan'}
      </button>
    {/if}

    {#if app.mode === 'catalog' && app.catalogPlan}
      <h4>Bundle contents</h4>
      <ul class="plan">
        {#each Object.values(app.catalogPlan.target) as target (target.id)}
          <li>
            <span class="badge info">include</span>
            {target.id}
            {target.version}
            {#if target.autoInstalled}
              <span class="muted">(required by your selection)</span>
            {/if}
          </li>
        {/each}
      </ul>
      {#each app.catalogPlan.warnings as w (w.message)}
        <p class="warn-line">⚠ {w.message}</p>
      {/each}
      {#each app.recommendHints(app.catalogPlan) as hint (hint.id)}
        <p class="hint-line">
          ◇ {hint.from} recommends <strong>{hint.id}</strong> {hint.range}{hint.description
            ? ` — ${hint.description}`
            : ''}
          <button class="small" onclick={() => app.addInstall(hint.id)}>add</button>
        </p>
      {/each}
      <p class="muted">Download: {formatBytes(app.catalogDownloadBytes())} ({app.platform})</p>

      {#if app.bundling}
        <div class="progress">
          <p>{app.applyPhase ?? 'Working…'}</p>
          {#if app.download}
            <progress
              max={app.download.total ?? undefined}
              value={app.download.total ? app.download.received : undefined}
            ></progress>
            <span class="muted">
              {formatBytes(app.download.received)}{app.download.total
                ? ` / ${formatBytes(app.download.total)}`
                : ''}
            </span>
          {:else if app.fileProgress}
            <span class="muted mono">{app.fileProgress.path}</span>
          {/if}
        </div>
      {:else}
        <button class="primary" onclick={() => app.downloadBundle()}>
          Download mods (.zip)
        </button>
        <p class="muted small-hint">
          This browser has no File System Access API, so toybox cannot install directly. The zip
          is checksum-verified end to end; extract it into
          <code>Documents\My Games\Kitten Space Agency\mods\</code> and you have exactly what a
          managed install would have written.
        </p>
      {/if}
    {/if}

    {#if app.bundleDone}
      <p class="done">
        ✓ Saved <code>{app.bundleDone.filename}</code> ({app.bundleDone.contents
          .map((c) => `${c.id} ${c.version}`)
          .join(', ')}). Extract it into
        <code>Documents\My Games\Kitten Space Agency\mods\</code>.
      </p>
    {/if}

    {#if app.planFailure}
      <div class="failure">
        <strong>Cannot build a consistent plan</strong>
        <pre>{app.planFailure.explanation}</pre>
      </div>
    {/if}

    {#if app.planned}
      <h4>Plan — {app.planned.plan.operations.length} operations</h4>
      <ul class="plan">
        {#each app.planned.changes as change (change.id)}
          <li>
            {#if change.kind === 'install'}
              <span class="badge info">install</span> {change.id} {change.version}
              {#if change.reasons[0] && change.reasons[0].requiredBy !== 'user'}
                <span class="muted">(needed by {change.reasons[0].requiredBy})</span>
              {/if}
            {:else if change.kind === 'upgrade'}
              <span class="badge good">upgrade</span> {change.id} {change.from} → {change.to}
            {:else if change.kind === 'downgrade'}
              <span class="badge warn">downgrade</span> {change.id} {change.from} → {change.to}
            {:else}
              <span class="badge bad">remove</span> {change.id} {change.version}
              <span class="muted">({change.reason})</span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if app.planned.resolution.warnings.length > 0}
        {#each app.planned.resolution.warnings as w (w.message)}
          <p class="warn-line">⚠ {w.message}</p>
        {/each}
      {/if}
      {#if app.planned.warnings.length > 0}
        {#each app.planned.warnings as w (w.message)}
          <p class="warn-line">⚠ {w.message}</p>
        {/each}
      {/if}
      {#each app.recommendHints(app.planned.resolution) as hint (hint.id)}
        <p class="hint-line">
          ◇ {hint.from} recommends <strong>{hint.id}</strong> {hint.range}{hint.description
            ? ` — ${hint.description}`
            : ''}
          <button class="small" onclick={() => app.addInstall(hint.id)}>add</button>
        </p>
      {/each}
      <p class="muted">Download: {formatBytes(app.planned.plan.totalDownloadBytes)}</p>

      {#if needsAck}
        <label class="ack">
          <input type="checkbox" bind:checked={acknowledgeWarnings} />
          I understand the warnings above
        </label>
      {/if}

      {#if app.applying}
        <div class="progress">
          <p>{app.applyPhase ?? 'Working…'}</p>
          {#if app.download}
            <progress
              max={app.download.total ?? undefined}
              value={app.download.total ? app.download.received : undefined}
            ></progress>
            <span class="muted">
              {formatBytes(app.download.received)}{app.download.total
                ? ` / ${formatBytes(app.download.total)}`
                : ''}
            </span>
          {:else if app.fileProgress}
            <span class="muted mono">
              {app.fileProgress.index}{app.fileProgress.total ? `/${app.fileProgress.total}` : ''}
              {app.fileProgress.path}
            </span>
          {/if}
        </div>
      {:else}
        <button
          class="primary"
          disabled={needsAck && !acknowledgeWarnings}
          onclick={() => app.applyPlan(hasUnmanagedOverwrite && acknowledgeWarnings)}
        >
          Apply transaction
        </button>
      {/if}
    {/if}
  {/if}

  {#if app.applyError}
    <div class="failure">
      <strong>Apply failed — nothing partial was left behind</strong>
      <pre>{app.applyError}</pre>
    </div>
  {/if}
  {#if app.applyDone}
    <p class="done">
      ✓ Done.
      {#if app.applyDone.installed.length}Installed/updated: {app.applyDone.installed.join(', ')}.{/if}
      {#if app.applyDone.removed.length}Removed: {app.applyDone.removed.join(', ')}.{/if}
    </p>
  {/if}

  {#if app.localFileRequest}
    {@const req = app.localFileRequest}
    <div class="localfile">
      <strong>Direct download blocked (CORS / rate limit)</strong>
      <p>
        Download <code>{req.artifact.url.split('/').at(-1)}</code> for
        <strong>{req.modId}</strong> yourself, then hand toybox the file — it is verified by
        checksum exactly like a direct download.
      </p>
      <div class="row">
        <a href={req.artifact.url} target="_blank" rel="noopener noreferrer">
          <button class="small">1. Open download</button>
        </a>
        <label class="filepick">
          2. Pick the downloaded file
          <input
            type="file"
            accept=".zip"
            onchange={(e) => {
              const file = (e.currentTarget as HTMLInputElement).files?.[0]
              if (file) req.provide(file)
            }}
          />
        </label>
        <button class="small danger" onclick={() => req.abort('cancelled by user')}>Cancel</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .drawer {
    position: fixed;
    top: 70px;
    right: 20px;
    width: 440px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 90px);
    overflow-y: auto;
    z-index: 20;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .head h3 {
    margin: 0;
  }
  .items,
  .plan {
    list-style: none;
    padding: 0;
    margin: 10px 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .failure {
    margin-top: 10px;
    border: 1px solid var(--bad);
    border-radius: 8px;
    padding: 10px;
  }
  .failure pre {
    white-space: pre-wrap;
    font-size: 12px;
    margin: 6px 0 0;
  }
  .warn-line {
    color: var(--warn);
    margin: 4px 0;
    font-size: 13px;
  }
  .hint-line {
    color: var(--text-dim);
    margin: 4px 0;
    font-size: 13px;
  }
  .hint-line button {
    margin-left: 6px;
  }
  .ack {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 10px 0;
  }
  .progress progress {
    width: 100%;
  }
  .mono {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    word-break: break-all;
  }
  .done {
    color: var(--good);
  }
  .localfile {
    margin-top: 12px;
    border: 1px solid var(--warn);
    border-radius: 8px;
    padding: 10px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .platform-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 6px 0 10px;
  }
  .small-hint {
    font-size: 12px;
    margin-top: 8px;
  }
  .filepick {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    cursor: pointer;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 12px;
  }
</style>
