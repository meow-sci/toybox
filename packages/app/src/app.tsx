import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import {
  $active,
  $cartSize,
  $fatalError,
  $grant,
  $grantName,
  $indexError,
  $mode,
  $recovery,
  $selectedModId,
  $view,
  refreshIndex,
  indexBrowseUrl,
  type View,
} from './state/appStore.ts'
import { Badge, Button, Link, cn } from './ui/kit'
import { BrowseView } from './components/BrowseView.tsx'
import { CartPanel } from './components/CartPanel.tsx'
import { GrantScreen } from './components/GrantScreen.tsx'
import { InstalledView } from './components/InstalledView.tsx'
import { ModDetail } from './components/ModDetail.tsx'
import { SettingsView } from './components/SettingsView.tsx'
import { ThemeToggle } from './components/ThemeToggle.tsx'

function NavButton({ view, children }: { view: View; children: React.ReactNode }) {
  const active = useStore($view)
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('text-sm', active === view && 'font-semibold text-accent')}
      onPress={() => $view.set(view)}
    >
      {children}
    </Button>
  )
}

function Banner({ tone, children }: { tone: 'info' | 'bad'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'mb-3.5 flex flex-wrap items-center gap-2.5 rounded-lg px-3.5 py-2.5',
        tone === 'info' ? 'border border-accent-muted bg-accent/12' : 'border border-bad bg-bad/12',
      )}
    >
      {children}
    </div>
  )
}

export function App() {
  const active = useStore($active)
  const mode = useStore($mode)
  const grant = useStore($grant)
  const grantName = useStore($grantName)
  const view = useStore($view)
  const cartSize = useStore($cartSize)
  const recovery = useStore($recovery)
  const fatalError = useStore($fatalError)
  const indexError = useStore($indexError)
  const selectedModId = useStore($selectedModId)

  const [cartOpen, setCartOpen] = useState(false)

  if (!active) return <GrantScreen />

  return (
    <div className="mx-auto max-w-[1080px] px-4 pb-16 sm:px-5">
      <header className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border py-3.5">
        <div className="flex items-center gap-2 text-base">
          <span className="text-xl">🧶</span>
          <strong>toybox</strong>
          {mode === 'catalog' ? (
            <Badge
              tone="info"
              title="This browser has no File System Access API, so toybox cannot install directly — selections become a verified .zip download instead."
            >
              browse mode
            </Badge>
          ) : (
            <>
              <span className="hidden text-fg-muted sm:inline">
                {grantName}/{grant?.mode === 'ksa-root' ? 'mods' : ''}
              </span>
              {grant?.mode === 'mods-only' && (
                <Badge
                  tone="warn"
                  title="Grant the Kitten Space Agency folder (the parent of mods/) to enable enable/disable via manifest.toml"
                >
                  mods-only grant
                </Badge>
              )}
            </>
          )}
        </div>
        <nav className="order-last flex w-full flex-1 gap-1.5 sm:order-none sm:w-auto">
          <NavButton view="browse">Browse</NavButton>
          {mode === 'full' && (
            <>
              <NavButton view="installed">Installed</NavButton>
              <NavButton view="settings">Settings</NavButton>
            </>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button variant="primary" onPress={() => setCartOpen((v) => !v)}>
            <ShoppingCart size={15} />
            Cart{cartSize > 0 ? ` (${cartSize})` : ''}
          </Button>
        </div>
      </header>

      {recovery && (
        <Banner tone="info">
          <strong>Recovered:</strong> {recovery.detail}
          <Button size="sm" onPress={() => $recovery.set(null)}>
            Dismiss
          </Button>
        </Banner>
      )}
      {fatalError && <Banner tone="bad">{fatalError}</Banner>}
      {indexError && (
        <Banner tone="bad">
          Could not load the mod index: {indexError}
          <Button size="sm" onPress={() => void refreshIndex()}>
            Retry
          </Button>
        </Banner>
      )}

      <main>
        {view === 'browse' ? (
          <BrowseView />
        ) : view === 'installed' ? (
          <InstalledView />
        ) : (
          <SettingsView />
        )}
      </main>

      {selectedModId && (
        <ModDetail modId={selectedModId} onClose={() => $selectedModId.set(null)} />
      )}
      {cartOpen && <CartPanel onClose={() => setCartOpen(false)} />}

      <footer className="mt-10 border-t border-border pt-3 text-right text-[11px]">
        <Link
          href={indexBrowseUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fg-muted no-underline hover:text-accent hover:underline"
        >
          browse index
        </Link>
      </footer>
    </div>
  )
}
