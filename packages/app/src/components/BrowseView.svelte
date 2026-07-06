<script lang="ts">
  import { app } from '../lib/toybox.svelte.ts'
  import { formatDate } from '../lib/format.ts'

  const results = $derived(app.results())
</script>

<div class="browse">
  <div class="searchbar">
    <input
      type="search"
      placeholder="Search mods — try 'terminal', 'qemu', or fuzzy fragments like 'ptty'…"
      bind:value={app.query}
    />
    <span class="muted">{results.length} of {app.index?.mods.length ?? 0} mods</span>
  </div>

  {#if !app.index}
    <p class="muted">Loading index…</p>
  {:else}
    <div class="grid">
      {#each results as r (r.item.id)}
        {@const installed = app.installedById(r.item.id)}
        {@const latest = app.releasesFor(r.item)[0]}
        <button class="card mod" onclick={() => (app.selectedModId = r.item.id)}>
          <div class="head">
            <strong>{r.item.name}</strong>
            {#if latest}
              <span class="muted">v{latest.version}</span>
            {/if}
            {#if installed}
              {@const update = app.updateAvailable(installed)}
              {#if update}
                <span class="badge warn">update → {update}</span>
              {:else}
                <span class="badge good">installed {installed.version}</span>
              {/if}
            {/if}
            {#if app.inCart(r.item.id)}
              <span class="badge info">in cart: {app.inCart(r.item.id)}</span>
            {/if}
          </div>
          <p class="summary">{r.item.summary}</p>
          <div class="meta">
            {#each r.item.tags as tag (tag)}
              <span class="tag">{tag}</span>
            {/each}
            <span class="muted spacer">
              {r.item.authors.join(', ')}
              {#if latest?.publishedAt}
                · {formatDate(latest.publishedAt)}
              {/if}
            </span>
          </div>
        </button>
      {/each}
    </div>
    {#if results.length === 0}
      <p class="muted">No mods match “{app.query}”.</p>
    {/if}
  {/if}
</div>

<style>
  .searchbar {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 16px;
  }
  .searchbar input {
    flex: 1;
    font-size: 15px;
    padding: 9px 14px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 12px;
  }
  .mod {
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 6px;
    cursor: pointer;
  }
  .mod:hover {
    border-color: var(--accent-dim);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .summary {
    margin: 0;
    color: var(--text-dim);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .meta {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
    font-size: 12px;
  }
  .spacer {
    margin-left: auto;
  }
</style>
