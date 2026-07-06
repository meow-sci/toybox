<script lang="ts">
  import { DEFAULT_INDEX_URL } from '@toybox/core'
  import { app } from '../lib/toybox.svelte.ts'

  let ksaVersion = $state(app.settings?.ksaVersion ?? '')
  let githubToken = $state(app.settings?.githubToken ?? '')
  let indexUrl = $state(app.settings?.indexUrl ?? '')
</script>

<div class="settings">
  <div class="card block">
    <h3>Release channel</h3>
    <p class="muted">Prereleases (tip builds) are hidden on the stable channel.</p>
    <select
      value={app.settings?.channel ?? 'stable'}
      onchange={(e) => app.saveSettings({ channel: e.currentTarget.value as 'stable' | 'prerelease' })}
    >
      <option value="stable">stable</option>
      <option value="prerelease">prerelease (include tip builds)</option>
    </select>
  </div>

  <div class="card block">
    <h3>KSA game version</h3>
    <p class="muted">
      Used to filter releases by compatibility (e.g. <code>2026.7.3.4826</code> — the third number
      is ignored, it is per-build noise). Leave empty to skip compatibility filtering.
    </p>
    <div class="row">
      <input placeholder="2026.7.3.4826" bind:value={ksaVersion} />
      <button onclick={() => app.saveSettings(ksaVersion ? { ksaVersion } : { ksaVersion: undefined as never })}>
        Save
      </button>
    </div>
  </div>

  <div class="card block">
    <h3>GitHub token (optional)</h3>
    <p class="muted">
      Downloads use the GitHub API (60 requests/hour without a token). A fine-grained token with
      <em>no scopes</em> raises that limit. Stored only in <code>mods/.toybox/settings.json</code>
      on your disk.
    </p>
    <div class="row">
      <input type="password" placeholder="github_pat_…" bind:value={githubToken} />
      <button onclick={() => app.saveSettings({ githubToken: githubToken || (undefined as never) })}>
        Save
      </button>
    </div>
  </div>

  <div class="card block">
    <h3>Index URL</h3>
    <p class="muted">Default: <code>{DEFAULT_INDEX_URL}</code></p>
    <div class="row">
      <input placeholder={DEFAULT_INDEX_URL} bind:value={indexUrl} />
      <button onclick={() => app.saveSettings({ indexUrl: indexUrl || (undefined as never) })}>
        Save & reload index
      </button>
    </div>
  </div>

  <div class="card block">
    <h3>Folder access</h3>
    <p class="muted">
      Managing <code>{app.grantName}</code> ({app.grant?.mode === 'ksa-root'
        ? 'KSA folder — manifest.toml sync enabled'
        : 'mods folder only — re-pick the parent KSA folder to enable enable/disable'}).
    </p>
    <button class="danger" onclick={() => app.forget()}>Forget this folder</button>
  </div>
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 640px;
  }
  .block h3 {
    margin-top: 0;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .row input {
    flex: 1;
  }
</style>
