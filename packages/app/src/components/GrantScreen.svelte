<script lang="ts">
  import { app } from '../lib/toybox.svelte.ts'
  import ThemeToggle from './ThemeToggle.svelte'
</script>

<div class="grant">
  <div class="corner">
    <ThemeToggle />
  </div>
  <div class="card hero">
    <h1>🧶 toybox</h1>
    <p class="muted">
      A mod manager for <strong>Kitten Space Agency</strong> that runs entirely in your browser.
      No installer, no account, no cloud — your mods folder is the database.
    </p>

    {#if app.status === 'boot' || app.status === 'opening'}
      <p>Loading…</p>
    {:else if app.status === 'unsupported'}
      <p class="badge bad">
        This browser does not support the File System Access API. Use a Chromium-based browser
        (Chrome, Edge, Brave, …).
      </p>
    {:else if app.status === 'needs-permission'}
      <p>
        toybox previously managed <code>{app.grantName || 'your KSA folder'}</code> — the browser
        needs you to re-confirm access.
      </p>
      <div class="row">
        <button class="primary" onclick={() => app.regrantStored()}>Re-grant access</button>
        <button onclick={() => app.forget()}>Use a different folder</button>
      </div>
    {:else}
      <ol class="muted steps">
        <li>
          Pick your <code>Kitten Space Agency</code> folder — usually
          <code>Documents\My Games\Kitten Space Agency</code> (that enables enable/disable via the
          game's manifest). Picking just the <code>mods</code> folder works too.
        </li>
        <li>Browse, and stage installs into the cart.</li>
        <li>Review exactly what will change, then apply.</li>
      </ol>
      <button class="primary big" onclick={() => app.pick()}>Choose your KSA folder…</button>
      <p class="muted small-note">
        Everything toybox knows is stored in <code>mods/.toybox/</code> on your disk — wipe the
        browser and re-grant the folder, and nothing is lost. Manually installed mods are detected
        and can be adopted; unrecognized files are never touched.
      </p>
    {/if}
  </div>
</div>

<style>
  .grant {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 20px;
  }
  .corner {
    position: fixed;
    top: 14px;
    right: 16px;
  }
  .hero {
    max-width: 560px;
    padding: 30px 34px;
  }
  h1 {
    margin-top: 0;
  }
  .row {
    display: flex;
    gap: 10px;
  }
  .big {
    font-size: 16px;
    padding: 10px 18px;
  }
  .steps {
    padding-left: 20px;
  }
  .steps li {
    margin-bottom: 6px;
  }
  .small-note {
    font-size: 12px;
    margin-top: 16px;
  }
</style>
