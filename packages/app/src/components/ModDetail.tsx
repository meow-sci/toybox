import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import {
  $cartInstall,
  $cartRemove,
  $index,
  $installed,
  $platform,
  $readmes,
  addInstall,
  addRemove,
  dropFromCart,
  inCart,
  installedById,
  loadReadme,
  modBrowseUrl,
  modById,
  sortedReleases,
} from '../state/appStore.ts'
import { Badge, Button, Dialog, DisclosureGroup, Link, Modal } from '../ui/kit'
import { CartFab } from './CartFab.tsx'
import { Markdown } from './Markdown.tsx'
import { ReleaseSection } from './ReleaseSection.tsx'

export function ModDetail({ modId, onClose }: { modId: string; onClose: () => void }) {
  const index = useStore($index)
  const installed = useStore($installed)
  const platform = useStore($platform)
  const readmes = useStore($readmes)
  const cartInstall = useStore($cartInstall)
  const cartRemove = useStore($cartRemove)

  const mod = modById(index, modId)
  const installedMod = installedById(installed, modId)
  // Show EVERY version — availability for the current platform is marked
  // per release instead of silently hiding foreign-platform releases.
  const releases = mod ? sortedReleases(mod) : []
  const readme = readmes[modId]
  const browseUrl = mod ? modBrowseUrl(mod) : null
  const carted = inCart(cartInstall, cartRemove, modId)

  useEffect(() => {
    if (mod) loadReadme(mod)
  }, [mod])

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()}>
      <Dialog aria-label={modId}>
        {!mod ? (
          <p>Unknown mod: {modId}</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <h2 className="m-0 flex-1 text-xl font-bold">{mod.name}</h2>
              {installedMod && <Badge tone="good">installed {installedMod.version}</Badge>}
              <Button size="sm" aria-label="Close" onPress={onClose}>
                <X size={13} /> close
              </Button>
            </div>
            <p className="text-fg-muted">{mod.summary}</p>
            <div className="text-fg-muted">
              {mod.authors.join(', ')}
              {mod.license && <> · {mod.license}</>}
              {mod.repository && (
                <>
                  {' · '}
                  <Link
                    href={mod.repository}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent"
                  >
                    repository
                  </Link>
                </>
              )}
              {mod.homepage && (
                <>
                  {' · '}
                  <Link
                    href={mod.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent"
                  >
                    homepage
                  </Link>
                </>
              )}
              {' · maintained by '}
              {mod.owners.map((o) => `@${o}`).join(', ')}
              {browseUrl && (
                <>
                  {' · '}
                  <Link
                    href={browseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-fg-muted hover:text-accent"
                  >
                    index
                  </Link>
                </>
              )}
            </div>

            <h3 className="mt-5 mb-2 font-semibold">Releases</h3>
            <DisclosureGroup
              allowsMultipleExpanded
              defaultExpandedKeys={releases[0] ? [releases[0].version] : []}
            >
              {releases.map((rel, i) => (
                <ReleaseSection
                  key={rel.version}
                  modId={mod.id}
                  release={rel}
                  platform={platform}
                  isLatest={i === 0}
                  installedMod={installedMod}
                />
              ))}
            </DisclosureGroup>

            <div className="mt-3.5 flex flex-wrap gap-2.5">
              {carted ? (
                <Button onPress={() => dropFromCart(mod.id)}>Remove from cart</Button>
              ) : (
                <>
                  <Button variant="primary" onPress={() => addInstall(mod.id)}>
                    {installedMod ? 'Upgrade to latest' : 'Install latest'}
                  </Button>
                  {installedMod && (
                    <Button variant="danger" onPress={() => addRemove(mod.id)}>
                      Uninstall…
                    </Button>
                  )}
                </>
              )}
            </div>

            {mod.readmePath && (
              <>
                <hr className="my-4 border-0 border-t border-border" />
                {readme === 'loading' || readme === undefined ? (
                  <p className="text-fg-muted">Loading readme…</p>
                ) : readme === null ? (
                  <p className="text-fg-muted">The readme could not be loaded.</p>
                ) : (
                  <Markdown source={readme} />
                )}
              </>
            )}
          </>
        )}
        <CartFab />
      </Dialog>
    </Modal>
  )
}
