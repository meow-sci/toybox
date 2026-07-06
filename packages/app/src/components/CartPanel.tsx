import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { X } from 'lucide-react'
import { ALL_PLATFORMS, type Platform } from '@toybox/core'
import { formatBytes } from '../lib/format.ts'
import {
  $applyDone,
  $applyError,
  $applyPhase,
  $applying,
  $bundleDone,
  $bundling,
  $cartInstall,
  $cartRemove,
  $cartSize,
  $catalogPlan,
  $download,
  $fileProgress,
  $index,
  $installed,
  $localFileRequest,
  $mode,
  $planFailure,
  $planned,
  $planning,
  $platform,
  addInstall,
  applyPlan,
  buildCatalogPlan,
  buildPlan,
  catalogDownloadBytes,
  downloadBundle,
  dropFromCart,
  recommendHints,
  setPlatform,
} from '../state/appStore.ts'
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  FileTrigger,
  Label,
  Modal,
  ProgressBar,
  Select,
} from '../ui/kit'
import type { RecommendHint } from '../state/appStore.ts'

function ProgressBlock() {
  const applyPhase = useStore($applyPhase)
  const download = useStore($download)
  const fileProgress = useStore($fileProgress)
  return (
    <div className="my-2">
      <p>{applyPhase ?? 'Working…'}</p>
      {download ? (
        <>
          <ProgressBar
            aria-label="Download progress"
            isIndeterminate={download.total === null}
            value={download.total ? download.received : 0}
            maxValue={download.total ?? 100}
          />
          <span className="text-fg-muted">
            {formatBytes(download.received)}
            {download.total ? ` / ${formatBytes(download.total)}` : ''}
          </span>
        </>
      ) : fileProgress ? (
        <span className="font-mono text-[11px] break-all text-fg-muted">
          {fileProgress.total ? `${fileProgress.index}/${fileProgress.total} ` : ''}
          {fileProgress.path}
        </span>
      ) : null}
    </div>
  )
}

function HintLine({ hint }: { hint: RecommendHint }) {
  return (
    <p className="my-1 text-[13px] text-fg-muted">
      ◇ {hint.from} recommends <strong>{hint.id}</strong> {hint.range}
      {hint.description ? ` — ${hint.description}` : ''}
      <Button size="sm" className="ml-1.5" onPress={() => addInstall(hint.id)}>
        add
      </Button>
    </p>
  )
}

export function CartPanel({ onClose }: { onClose: () => void }) {
  const mode = useStore($mode)
  const platform = useStore($platform)
  const index = useStore($index)
  const installed = useStore($installed)
  const cartInstall = useStore($cartInstall)
  const cartRemove = useStore($cartRemove)
  const cartSize = useStore($cartSize)
  const planned = useStore($planned)
  const planFailure = useStore($planFailure)
  const planning = useStore($planning)
  const applying = useStore($applying)
  const applyError = useStore($applyError)
  const applyDone = useStore($applyDone)
  const catalogPlan = useStore($catalogPlan)
  const bundling = useStore($bundling)
  const bundleDone = useStore($bundleDone)
  const localFileRequest = useStore($localFileRequest)

  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false)

  const hasUnmanagedOverwrite =
    planned?.plan.operations.some((op) => op.kind !== 'remove' && op.overwritesUnmanaged) ?? false
  const needsAck = (planned?.warnings.length ?? 0) > 0 || hasUnmanagedOverwrite

  return (
    <Modal placement="right" isOpen onOpenChange={(open) => !open && onClose()}>
      <Dialog aria-label="Transaction cart">
        <div className="flex items-center justify-between">
          <h3 className="m-0 font-semibold">Transaction cart</h3>
          <Button size="sm" aria-label="Close cart" onPress={onClose}>
            <X size={13} />
          </Button>
        </div>

        {cartSize === 0 && !applyDone && !bundleDone ? (
          <p className="text-fg-muted">
            {mode === 'catalog'
              ? 'Empty. Stage mods here, review the resolved selection, then download everything as one verified .zip.'
              : 'Empty. Stage installs, upgrades, and removals here, review the full plan, then apply them as one transaction.'}
          </p>
        ) : (
          <>
            <ul className="my-2.5 flex list-none flex-col gap-1.5 p-0">
              {cartInstall.map((item) => (
                <li key={item.id} className="flex items-center gap-2">
                  <Badge tone="info">install</Badge>
                  {item.id} {item.version ? `@${item.version}` : '(latest)'}
                  <Button size="sm" onPress={() => dropFromCart(item.id)}>
                    drop
                  </Button>
                </li>
              ))}
              {cartRemove.map((id) => (
                <li key={id} className="flex items-center gap-2">
                  <Badge tone="bad">remove</Badge>
                  {id}
                  <Button size="sm" onPress={() => dropFromCart(id)}>
                    drop
                  </Button>
                </li>
              ))}
            </ul>

            {cartInstall.length > 0 && (
              <div className="my-1.5 mb-2.5 flex items-center gap-2">
                <Label>{mode === 'catalog' ? 'Bundle for' : 'Target platform'}</Label>
                <Select
                  aria-label="Target platform"
                  options={ALL_PLATFORMS.map((p) => ({ id: p, label: p }))}
                  selectedKey={platform}
                  onSelectionChange={(key) => setPlatform(key as Platform)}
                />
              </div>
            )}

            {mode === 'catalog'
              ? !catalogPlan &&
                !planFailure &&
                cartInstall.length > 0 && (
                  <Button variant="primary" onPress={buildCatalogPlan}>
                    Review selection
                  </Button>
                )
              : !planned &&
                !planFailure &&
                cartSize > 0 && (
                  <Button variant="primary" isDisabled={planning} onPress={() => void buildPlan()}>
                    {planning ? 'Resolving…' : 'Review plan'}
                  </Button>
                )}

            {mode === 'catalog' && catalogPlan && (
              <>
                <h4 className="mt-3 mb-1 font-semibold">Bundle contents</h4>
                <ul className="my-2.5 flex list-none flex-col gap-1.5 p-0">
                  {Object.values(catalogPlan.target).map((target) => (
                    <li key={target.id} className="flex flex-wrap items-center gap-2">
                      <Badge tone="info">include</Badge>
                      {target.id} {target.version}
                      {target.autoInstalled && (
                        <span className="text-fg-muted">(required by your selection)</span>
                      )}
                    </li>
                  ))}
                </ul>
                {catalogPlan.warnings.map((w) => (
                  <p key={w.message} className="my-1 text-[13px] text-warn">
                    ⚠ {w.message}
                  </p>
                ))}
                {recommendHints(index, installed, catalogPlan).map((hint) => (
                  <HintLine key={hint.id} hint={hint} />
                ))}
                <p className="text-fg-muted">
                  Download: {formatBytes(catalogDownloadBytes(index, catalogPlan, platform))} (
                  {platform})
                </p>

                {bundling ? (
                  <ProgressBlock />
                ) : (
                  <>
                    <Button variant="primary" onPress={() => void downloadBundle()}>
                      Download mods (.zip)
                    </Button>
                    <p className="mt-2 text-xs text-fg-muted">
                      This browser has no File System Access API, so toybox cannot install directly.
                      The zip is checksum-verified end to end; extract it into
                      <code> Documents\My Games\Kitten Space Agency\mods\</code> and you have
                      exactly what a managed install would have written.
                    </p>
                  </>
                )}
              </>
            )}

            {bundleDone && (
              <p className="text-good">
                ✓ Saved <code>{bundleDone.filename}</code> (
                {bundleDone.contents.map((c) => `${c.id} ${c.version}`).join(', ')}). Extract it
                into <code>Documents\My Games\Kitten Space Agency\mods\</code>.
              </p>
            )}

            {planFailure && (
              <div className="mt-2.5 rounded-lg border border-bad p-2.5">
                <strong>Cannot build a consistent plan</strong>
                <pre className="mt-1.5 mb-0 text-xs whitespace-pre-wrap">
                  {planFailure.explanation}
                </pre>
              </div>
            )}

            {planned && (
              <>
                <h4 className="mt-3 mb-1 font-semibold">
                  Plan — {planned.plan.operations.length} operations
                </h4>
                <ul className="my-2.5 flex list-none flex-col gap-1.5 p-0">
                  {planned.changes.map((change) => (
                    <li key={change.id} className="flex flex-wrap items-center gap-2">
                      {change.kind === 'install' ? (
                        <>
                          <Badge tone="info">install</Badge> {change.id} {change.version}
                          {change.reasons[0] && change.reasons[0].requiredBy !== 'user' && (
                            <span className="text-fg-muted">
                              (needed by {change.reasons[0].requiredBy})
                            </span>
                          )}
                        </>
                      ) : change.kind === 'upgrade' ? (
                        <>
                          <Badge tone="good">upgrade</Badge> {change.id} {change.from} → {change.to}
                        </>
                      ) : change.kind === 'downgrade' ? (
                        <>
                          <Badge tone="warn">downgrade</Badge> {change.id} {change.from} →{' '}
                          {change.to}
                        </>
                      ) : (
                        <>
                          <Badge tone="bad">remove</Badge> {change.id} {change.version}
                          <span className="text-fg-muted">({change.reason})</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                {planned.resolution.warnings.map((w) => (
                  <p key={w.message} className="my-1 text-[13px] text-warn">
                    ⚠ {w.message}
                  </p>
                ))}
                {planned.warnings.map((w) => (
                  <p key={w.message} className="my-1 text-[13px] text-warn">
                    ⚠ {w.message}
                  </p>
                ))}
                {recommendHints(index, installed, planned.resolution).map((hint) => (
                  <HintLine key={hint.id} hint={hint} />
                ))}
                <p className="text-fg-muted">
                  Download: {formatBytes(planned.plan.totalDownloadBytes)}
                </p>

                {needsAck && (
                  <Checkbox
                    className="my-2.5"
                    isSelected={acknowledgeWarnings}
                    onChange={setAcknowledgeWarnings}
                  >
                    I understand the warnings above
                  </Checkbox>
                )}

                {applying ? (
                  <ProgressBlock />
                ) : (
                  <Button
                    variant="primary"
                    isDisabled={needsAck && !acknowledgeWarnings}
                    onPress={() => void applyPlan(hasUnmanagedOverwrite && acknowledgeWarnings)}
                  >
                    Apply transaction
                  </Button>
                )}
              </>
            )}
          </>
        )}

        {applyError && (
          <div className="mt-2.5 rounded-lg border border-bad p-2.5">
            <strong>Apply failed — nothing partial was left behind</strong>
            <pre className="mt-1.5 mb-0 text-xs whitespace-pre-wrap">{applyError}</pre>
          </div>
        )}
        {applyDone && (
          <p className="text-good">
            ✓ Done.{' '}
            {applyDone.installed.length > 0 &&
              `Installed/updated: ${applyDone.installed.join(', ')}. `}
            {applyDone.removed.length > 0 && `Removed: ${applyDone.removed.join(', ')}.`}
          </p>
        )}

        {localFileRequest && (
          <div className="mt-3 rounded-lg border border-warn p-2.5">
            <strong>Direct download blocked (CORS / rate limit)</strong>
            <p>
              Download <code>{localFileRequest.artifact.url.split('/').at(-1)}</code> for{' '}
              <strong>{localFileRequest.modId}</strong> yourself, then hand toybox the file — it is
              verified by checksum exactly like a direct download.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={localFileRequest.artifact.url}
                target="_blank"
                rel="noopener noreferrer"
                className="no-underline"
              >
                <Button size="sm">1. Open download</Button>
              </a>
              <FileTrigger
                acceptedFileTypes={['.zip']}
                onSelect={(files) => {
                  const file = files?.[0]
                  if (file) localFileRequest.provide(file)
                }}
              >
                <Button size="sm">2. Pick the downloaded file</Button>
              </FileTrigger>
              <Button
                size="sm"
                variant="danger"
                onPress={() => localFileRequest.abort('cancelled by user')}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Modal>
  )
}
