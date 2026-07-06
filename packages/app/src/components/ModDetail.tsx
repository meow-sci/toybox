import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { formatBytes, formatDate } from '../lib/format.ts'
import {
  $cartInstall,
  $cartRemove,
  $index,
  $installed,
  $platform,
  $readmes,
  addInstall,
  addRemove,
  artifactRef,
  dropFromCart,
  inCart,
  installedById,
  loadReadme,
  modBrowseUrl,
  modById,
  releasesFor,
} from '../state/appStore.ts'
import { Badge, Button, Dialog, Link, Modal, Tag } from '../ui/kit'
import { Markdown } from './Markdown.tsx'

export function ModDetail({ modId, onClose }: { modId: string; onClose: () => void }) {
  const index = useStore($index)
  const installed = useStore($installed)
  const platform = useStore($platform)
  const readmes = useStore($readmes)
  const cartInstall = useStore($cartInstall)
  const cartRemove = useStore($cartRemove)

  const mod = modById(index, modId)
  const installedMod = installedById(installed, modId)
  const releases = mod ? releasesFor(mod, platform) : []
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
            <div className="flex flex-col">
              {releases.map((rel) => {
                const artifact = artifactRef(rel, platform)
                return (
                  <div
                    key={rel.version}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border py-2"
                  >
                    <strong>{rel.version}</strong>
                    <span className="text-fg-muted">{formatDate(rel.publishedAt)}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {rel.channel === 'prerelease' && <Badge tone="warn">prerelease</Badge>}
                      {rel.ksa && <Tag>KSA {rel.ksa}</Tag>}
                      {rel.required.map((ref) => (
                        <Tag key={ref.id} title={ref.description ?? 'required'}>
                          ◆ {ref.id} {ref.range}
                        </Tag>
                      ))}
                      {rel.recommends.map((ref) => (
                        <Tag key={ref.id} title={ref.description ?? 'recommended'}>
                          ◇ {ref.id} {ref.range}
                        </Tag>
                      ))}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-fg-muted">
                        {artifact ? formatBytes(artifact.size) : '—'}
                      </span>
                      {installedMod?.version === rel.version ? (
                        <span className="text-fg-muted">current</span>
                      ) : (
                        <Button size="sm" onPress={() => addInstall(mod.id, rel.version)}>
                          {installedMod ? 'switch to' : 'add to cart'}
                        </Button>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>

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
      </Dialog>
    </Modal>
  )
}
