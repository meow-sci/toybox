import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { formatDate } from '../lib/format.ts'
import {
  $grant,
  $index,
  $installed,
  $manifestEnabled,
  $scan,
  $scanning,
  $verifyResults,
  addInstall,
  addRemove,
  adopt,
  forgetMod,
  refreshManifestState,
  rescan,
  setEnabled,
  updateAvailable,
  verifyMod,
} from '../state/appStore.ts'
import { Badge, Button, Checkbox, Tag, card } from '../ui/kit'

const rowCard = `${card} mb-2.5 flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center`

export function InstalledView() {
  const grant = useStore($grant)
  const index = useStore($index)
  const installed = useStore($installed)
  const scan = useStore($scan)
  const scanning = useStore($scanning)
  const verifyResults = useStore($verifyResults)
  const manifestEnabled = useStore($manifestEnabled)

  const [adoptError, setAdoptError] = useState<string | null>(null)
  const manifestSync = grant?.manifestSync ?? false

  useEffect(() => {
    if (manifestSync) void refreshManifestState()
  }, [manifestSync])

  return (
    <div>
      <div className="flex items-center gap-3">
        <h3 className="my-2 font-semibold">Managed mods</h3>
        <Button size="sm" isDisabled={scanning} onPress={() => void rescan()}>
          {scanning ? 'Scanning…' : 'Rescan folder'}
        </Button>
      </div>

      {installed.length === 0 && (
        <p className="text-fg-muted">
          Nothing managed yet — install something from Browse, or adopt a manual install below.
        </p>
      )}

      {installed.map((mod) => {
        const update = updateAvailable(index, mod)
        const verify = verifyResults[mod.id]
        const managedScan = scan?.managed.find((m) => m.installed.id === mod.id)
        const enabled = manifestEnabled[mod.id.toLowerCase()] ?? true
        return (
          <div key={mod.id} className={rowCard}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{mod.id}</strong>
                <span className="text-fg-muted">v{mod.version}</span>
                {mod.origin === 'adopted' && (
                  <Tag title="Taken over from a manual install after exact content verification">
                    adopted
                  </Tag>
                )}
                {mod.autoInstalled && (
                  <Tag title="Installed automatically as a dependency">dependency</Tag>
                )}
                {update && <Badge tone="warn">update available: {update}</Badge>}
                {managedScan && managedScan.status !== 'ok' && (
                  <Badge tone="bad" title={managedScan.problems.join('\n')}>
                    {managedScan.status}
                  </Badge>
                )}
                {manifestSync && (
                  <Checkbox
                    className="text-xs"
                    isSelected={enabled}
                    onChange={() => void setEnabled(mod.id, !enabled)}
                  >
                    <span title="Toggles the entry in the game's manifest.toml">enabled</span>
                  </Checkbox>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                {mod.files.length} files · installed {formatDate(mod.installedAt)}
                {verify &&
                  (verify.ok ? (
                    <Badge tone="good">
                      verified ✓{verify.extra.length ? ` (+${verify.extra.length} user files)` : ''}
                    </Badge>
                  ) : (
                    <>
                      <Badge tone="bad">
                        {verify.modified.length} modified, {verify.missing.length} missing
                      </Badge>
                      <span>{[...verify.modified, ...verify.missing].slice(0, 4).join(', ')}</span>
                    </>
                  ))}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              {update && (
                <Button size="sm" variant="primary" onPress={() => addInstall(mod.id)}>
                  Upgrade → cart
                </Button>
              )}
              <Button size="sm" onPress={() => void verifyMod(mod.id)}>
                Verify
              </Button>
              <Button size="sm" variant="danger" onPress={() => addRemove(mod.id)}>
                Remove → cart
              </Button>
              <Button size="sm" onPress={() => void forgetMod(mod.id)}>
                <span title="Stop managing without touching any files">Forget</span>
              </Button>
            </div>
          </div>
        )
      })}

      {scan && scan.foreign.length > 0 && (
        <>
          <h3 className="my-2 mt-5 font-semibold">Found in your mods folder (not managed)</h3>
          {adoptError && <Badge tone="bad">{adoptError}</Badge>}
          {scan.foreign.map((entry, i) => (
            <div key={entry.folder} className={rowCard}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{entry.folder}/</strong>
                  {entry.status === 'adoptable' ? (
                    <Badge tone="good">
                      matches {entry.catalogMod?.id} {entry.candidates[0]?.release.version}
                    </Badge>
                  ) : entry.status === 'recognized-modified' ? (
                    <Badge tone="warn">
                      recognized as {entry.catalogMod?.id}, but content differs
                    </Badge>
                  ) : entry.status === 'recognized-unverified' ? (
                    <Badge tone="warn">
                      looks like {entry.catalogMod?.id} (no manifest to verify against)
                    </Badge>
                  ) : (
                    <Badge tone="info">unknown — toybox will not touch it</Badge>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-fg-muted">
                  {entry.fileCount} files
                  {entry.modToml?.name &&
                    ` · mod.toml: ${entry.modToml.name} ${entry.modToml.version ?? ''}`}
                  {entry.status === 'recognized-modified' &&
                    entry.candidates[0] &&
                    ` · differs from ${entry.candidates[0].release.version}: ${[
                      ...entry.candidates[0].changedFiles,
                      ...entry.candidates[0].missingFiles,
                      ...entry.candidates[0].extraFiles,
                    ]
                      .slice(0, 4)
                      .join(', ')}`}
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                {entry.status === 'adoptable' ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onPress={() => void adopt(i, 0).then(setAdoptError)}
                  >
                    Adopt (verify checksums)
                  </Button>
                ) : entry.catalogMod ? (
                  <Button size="sm" onPress={() => addInstall(entry.catalogMod!.id)}>
                    <span title="Replace this folder with a clean managed install">
                      Reinstall cleanly → cart
                    </span>
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
