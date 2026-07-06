<script lang="ts">
  import { app } from './lib/toybox.svelte.ts'
  import GrantScreen from './components/GrantScreen.svelte'
  import BrowseView from './components/BrowseView.svelte'
  import InstalledView from './components/InstalledView.svelte'
  import SettingsView from './components/SettingsView.svelte'
  import ModDetail from './components/ModDetail.svelte'
  import CartPanel from './components/CartPanel.svelte'

  let cartOpen = $state(false)
  const active = $derived(app.status === 'ready' && (app.grant !== null || app.mode === 'catalog'))
</script>

{#if !active}
  <GrantScreen />
{:else}
  <div class="shell">
    <header>
      <div class="brand">
        <span class="logo">🧸</span>
        <strong>toybox</strong>
        {#if app.mode === 'catalog'}
          <span
            class="badge info"
            title="This browser has no File System Access API, so toybox cannot install directly — selections become a verified .zip download instead."
          >
            browse mode
          </span>
        {:else}
          <span class="muted">
            {app.grantName}/{app.grant?.mode === 'ksa-root' ? 'mods' : ''}
          </span>
          {#if app.grant?.mode === 'mods-only'}
            <span class="badge warn" title="Grant the Kitten Space Agency folder (the parent of mods/) to enable enable/disable via manifest.toml">
              mods-only grant
            </span>
          {/if}
        {/if}
      </div>
      <nav>
        <button class:active={app.view === 'browse'} onclick={() => (app.view = 'browse')}>
          Browse
        </button>
        {#if app.mode === 'full'}
          <button class:active={app.view === 'installed'} onclick={() => (app.view = 'installed')}>
            Installed ({app.installed.length})
          </button>
          <button class:active={app.view === 'settings'} onclick={() => (app.view = 'settings')}>
            Settings
          </button>
        {/if}
      </nav>
      <button class="primary cart-btn" onclick={() => (cartOpen = !cartOpen)}>
        Cart {app.cartSize > 0 ? `(${app.cartSize})` : ''}
      </button>
    </header>

    {#if app.recovery}
      <div class="banner info">
        <strong>Recovered:</strong>
        {app.recovery.detail}
        <button class="small" onclick={() => (app.recovery = null)}>Dismiss</button>
      </div>
    {/if}
    {#if app.fatalError}
      <div class="banner bad">{app.fatalError}</div>
    {/if}
    {#if app.indexError}
      <div class="banner bad">
        Could not load the mod index: {app.indexError}
        <button class="small" onclick={() => app.refreshIndex()}>Retry</button>
      </div>
    {/if}

    <main>
      {#if app.view === 'browse'}
        <BrowseView />
      {:else if app.view === 'installed'}
        <InstalledView />
      {:else}
        <SettingsView />
      {/if}
    </main>

    {#if app.selectedModId}
      <ModDetail modId={app.selectedModId} onclose={() => (app.selectedModId = null)} />
    {/if}
    {#if cartOpen}
      <CartPanel onclose={() => (cartOpen = false)} />
    {/if}

    <footer class="app-footer muted">
      <a href={app.indexBrowseUrl()} target="_blank" rel="noopener noreferrer">browse index</a>
    </footer>
  </div>
{/if}

<style>
  .shell {
    max-width: 1080px;
    margin: 0 auto;
    padding: 0 20px 60px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 14px 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
  }
  .logo {
    font-size: 20px;
  }
  nav {
    display: flex;
    gap: 6px;
    flex: 1;
  }
  nav button {
    background: none;
    border: none;
  }
  nav button.active {
    color: var(--accent);
    font-weight: 600;
  }
  .banner {
    border-radius: 8px;
    padding: 10px 14px;
    margin-bottom: 14px;
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .banner.info {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid var(--accent-dim);
  }
  .banner.bad {
    background: color-mix(in srgb, var(--bad) 12%, transparent);
    border: 1px solid var(--bad);
  }
  .app-footer {
    margin-top: 40px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    text-align: right;
  }
  .app-footer a {
    color: var(--text-dim);
    text-decoration: none;
  }
  .app-footer a:hover {
    color: var(--accent);
    text-decoration: underline;
  }
</style>
