import { useStore } from '@nanostores/react'
import type { CatalogRelease, CatalogReference, InstalledMod, Platform } from '@toybox/core'
import { formatBytes, formatDate } from '../lib/format.ts'
import { $manifests, addInstall, artifactRef, loadManifest } from '../state/appStore.ts'
import { Badge, Button, Disclosure, DisclosurePanel, DisclosureTrigger, Tag } from '../ui/kit'

function ReferenceList({
  title,
  marker,
  refs,
}: {
  title: string
  marker: string
  refs: CatalogReference[]
}) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">{title}</h4>
      {refs.length === 0 ? (
        <p className="my-0 text-[13px] text-fg-muted">none</p>
      ) : (
        <ul className="my-0 flex list-none flex-col gap-1 p-0 text-[13px]">
          {refs.map((ref) => (
            <li key={ref.id}>
              <span className="whitespace-nowrap">
                {marker} <strong>{ref.id}</strong> <Tag>{ref.range}</Tag>
              </span>
              {ref.description && <span className="text-fg-muted"> — {ref.description}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ManifestTable({ release, platform }: { release: CatalogRelease; platform: Platform }) {
  const manifests = useStore($manifests)
  const artifact = artifactRef(release, platform)
  const manifest = artifact ? manifests[artifact.sha256] : null

  return (
    <Disclosure
      onExpandedChange={(expanded) => {
        if (expanded && artifact) loadManifest(artifact)
      }}
    >
      <DisclosureTrigger className="py-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
        File manifest
        {artifact?.fileCount !== undefined && (
          <span className="font-normal normal-case">({artifact.fileCount} files)</span>
        )}
      </DisclosureTrigger>
      <DisclosurePanel>
        {!artifact || manifest === null ? (
          <p className="my-0 text-[13px] text-fg-muted">No per-file manifest is published.</p>
        ) : manifest === 'loading' || manifest === undefined ? (
          <p className="my-0 text-[13px] text-fg-muted">Loading manifest…</p>
        ) : (
          <div className="max-h-64 overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-surface-hover text-left">
                <tr>
                  <th className="px-2 py-1 font-semibold">path</th>
                  <th className="px-2 py-1 text-right font-semibold">size</th>
                </tr>
              </thead>
              <tbody>
                {manifest.files.map((f) => (
                  <tr key={f.path} className="border-t border-border">
                    <td className="px-2 py-0.5 font-mono break-all">{f.path}</td>
                    <td className="px-2 py-0.5 text-right whitespace-nowrap text-fg-muted">
                      {formatBytes(f.size)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DisclosurePanel>
    </Disclosure>
  )
}

export function ReleaseSection({
  modId,
  release,
  platform,
  isLatest,
  installedMod,
}: {
  modId: string
  release: CatalogRelease
  platform: Platform
  isLatest: boolean
  installedMod: InstalledMod | null
}) {
  const artifact = artifactRef(release, platform)
  const isCurrent = installedMod?.version === release.version

  return (
    <Disclosure id={release.version} className="border-t border-border">
      {/* Collapsed row: version · date · latest chip · add-to-cart only. */}
      <div className="flex items-center gap-2">
        <DisclosureTrigger>
          <strong>{release.version}</strong>
          <span className="text-fg-muted">{formatDate(release.publishedAt)}</span>
          {isLatest && <Badge tone="info">latest</Badge>}
        </DisclosureTrigger>
        {isCurrent ? (
          <span className="text-fg-muted">current</span>
        ) : (
          <Button size="sm" onPress={() => addInstall(modId, release.version)}>
            {installedMod ? 'switch to' : 'add to cart'}
          </Button>
        )}
      </div>

      <DisclosurePanel>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <Badge tone={release.channel === 'prerelease' ? 'warn' : 'good'}>
              {release.channel}
            </Badge>
            {release.ksa && <Tag>KSA {release.ksa}</Tag>}
            {release.publishedAt && (
              <span className="text-fg-muted">published {formatDate(release.publishedAt)}</span>
            )}
            {artifact && (
              <span className="text-fg-muted">download {formatBytes(artifact.size)}</span>
            )}
            {artifact?.installSize !== undefined && (
              <span className="text-fg-muted">installed {formatBytes(artifact.installSize)}</span>
            )}
            {artifact && <Tag title="Artifact platforms">{artifact.platforms.join(' · ')}</Tag>}
          </div>

          <ManifestTable release={release} platform={platform} />

          <ReferenceList title="Required" marker="◆" refs={release.required} />
          <ReferenceList title="Recommended" marker="◇" refs={release.recommends} />
        </div>
      </DisclosurePanel>
    </Disclosure>
  )
}
