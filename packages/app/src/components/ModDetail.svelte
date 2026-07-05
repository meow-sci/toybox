<script lang="ts">
  import { app } from '../lib/toybox.svelte.ts'
  import { formatBytes, formatDate } from '../lib/format.ts'
  import Markdown from './Markdown.svelte'

  let { modId, onclose }: { modId: string; onclose: () => void } = $props()

  const mod = $derived(app.modById(modId))
  const installed = $derived(app.installedById(modId))
  const releases = $derived(mod && app.engine ? app.engine.eligibleReleases(mod) : [])
</script>

<div
  class="overlay"
  onclick={(e) => e.target === e.currentTarget && onclose()}
  onkeydown={(e) => e.key === 'Escape' && onclose()}
  role="presentation"
>
  <div class="panel card" role="dialog" aria-label={modId}>
    {#if !mod}
      <p>Unknown mod: {modId}</p>
    {:else}
      <div class="head">
        <h2>{mod.name}</h2>
        {#if installed}
          <span class="badge good">installed {installed.version}</span>
        {/if}
        <button class="small close" onclick={onclose}>✕ close</button>
      </div>
      <p class="muted">{mod.summary}</p>
      <div class="links muted">
        {mod.authors.join(', ')}
        {#if mod.license}· {mod.license}{/if}
        {#if mod.repository}
          · <a href={mod.repository} target="_blank" rel="noopener noreferrer">repository</a>
        {/if}
        {#if mod.homepage}
          · <a href={mod.homepage} target="_blank" rel="noopener noreferrer">homepage</a>
        {/if}
        · maintained by {mod.owners.map((o) => `@${o}`).join(', ')}
      </div>

      <h3>Releases</h3>
      <table class="releases">
        <tbody>
          {#each releases as rel (rel.version)}
            {@const artifact = app.engine?.artifactFor(rel)}
            <tr>
              <td><strong>{rel.version}</strong></td>
              <td class="muted">{formatDate(rel.publishedAt)}</td>
              <td>
                {#if rel.channel === 'prerelease'}<span class="badge warn">prerelease</span>{/if}
                {#if rel.ksa}<span class="tag">KSA {rel.ksa}</span>{/if}
                {#each rel.dependencies as dep (dep.id)}
                  <span class="tag" title="{dep.optional ? 'optional' : 'required'} dependency">
                    {dep.optional ? '◇' : '◆'} {dep.id} {dep.range}
                  </span>
                {/each}
              </td>
              <td class="muted">{artifact ? formatBytes(artifact.size) : '—'}</td>
              <td>
                {#if installed?.version === rel.version}
                  <span class="muted">current</span>
                {:else}
                  <button
                    class="small"
                    onclick={() => app.addInstall(mod.id, rel.version)}
                  >
                    {installed ? 'switch to' : 'add to cart'}
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      <div class="actions">
        {#if app.inCart(mod.id)}
          <button onclick={() => app.drop(mod.id)}>Remove from cart</button>
        {:else}
          <button class="primary" onclick={() => app.addInstall(mod.id)}>
            {installed ? 'Upgrade to latest' : 'Install latest'}
          </button>
          {#if installed}
            <button class="danger" onclick={() => app.addRemove(mod.id)}>Uninstall…</button>
          {/if}
        {/if}
      </div>

      {#if mod.readme}
        <hr />
        <Markdown source={mod.readme} />
      {/if}
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: start center;
    padding: 40px 20px;
    overflow-y: auto;
    z-index: 10;
  }
  .panel {
    max-width: 760px;
    width: 100%;
    padding: 22px 26px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .head h2 {
    margin: 0;
    flex: 1;
  }
  .links a {
    color: var(--accent);
  }
  .releases {
    width: 100%;
    border-collapse: collapse;
  }
  .releases td {
    padding: 6px 8px;
    border-top: 1px solid var(--border);
    vertical-align: top;
  }
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 14px;
  }
  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 18px 0;
  }
</style>
