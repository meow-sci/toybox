import { useStore } from '@nanostores/react'
import { Badge, Button, card } from '../ui/kit'
import { $grantName, $status, forget, pick, regrantStored } from '../state/appStore.ts'
import { ThemeToggle } from './ThemeToggle.tsx'

export function GrantScreen() {
  const status = useStore($status)
  const grantName = useStore($grantName)

  return (
    <div className="grid min-h-dvh place-items-center p-5">
      <div className="fixed top-3.5 right-4">
        <ThemeToggle />
      </div>
      <div className={`${card} max-w-xl px-6 py-7 sm:px-8`}>
        <h1 className="mt-0 text-2xl font-bold">🧶 toybox</h1>
        <p className="text-fg-muted">
          A mod manager for <strong>Kitten Space Agency</strong> that runs entirely in your browser.
          No installer, no account, no cloud — your mods folder is the database.
        </p>

        {status === 'boot' || status === 'opening' ? (
          <p>Loading…</p>
        ) : status === 'unsupported' ? (
          <Badge tone="bad">
            This browser does not support the File System Access API. Use a Chromium-based browser
            (Chrome, Edge, Brave, …).
          </Badge>
        ) : status === 'needs-permission' ? (
          <>
            <p>
              toybox previously managed <code>{grantName || 'your KSA folder'}</code> — the browser
              needs you to re-confirm access.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <Button variant="primary" onPress={() => void regrantStored()}>
                Re-grant access
              </Button>
              <Button onPress={() => void forget()}>Use a different folder</Button>
            </div>
          </>
        ) : (
          <>
            <ol className="list-decimal space-y-1.5 pl-5 text-fg-muted">
              <li>
                Pick your <code>Kitten Space Agency</code> folder — usually
                <code> Documents\My Games\Kitten Space Agency</code> (that enables enable/disable
                via the game's manifest). Picking just the <code>mods</code>
                folder works too.
              </li>
              <li>Browse, and stage installs into the cart.</li>
              <li>Review exactly what will change, then apply.</li>
            </ol>
            <Button variant="primary" size="lg" className="mt-4" onPress={() => void pick()}>
              Choose your KSA folder…
            </Button>
            <p className="mt-4 text-xs text-fg-muted">
              Everything toybox knows is stored in <code>mods/.toybox/</code> on your disk — wipe
              the browser and re-grant the folder, and nothing is lost. Manually installed mods are
              detected and can be adopted; unrecognized files are never touched.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
