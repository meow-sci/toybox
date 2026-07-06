import { useStore } from '@nanostores/react'
import {
  ALL_PLATFORMS,
  type CatalogArtifact,
  type CatalogRelease,
  type CatalogReference,
  type InstalledMod,
  type Platform,
} from '@toybox/core'
import { formatBytes, formatDate } from '../lib/format.ts'
import { $manifests, addInstallFor, artifactRef, loadManifest } from '../state/appStore.ts'
import { Badge, Disclosure, DisclosurePanel, DisclosureTrigger, SplitButton, Tag } from '../ui/kit'

/** Platforms this release ships artifacts for, in canonical order. */
function supportedPlatforms(release: CatalogRelease): Platform[] {
  const covered = new Set(release.artifacts.flatMap((a) => a.platforms))
  return ALL_PLATFORMS.filter((p) => covered.has(p))
}

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

/**
 * One collapsed manifest disclosure per artifact — NOT gated on the host
 * platform (release visibility is OS-agnostic, so the manifests are too).
 */
function ManifestSection({ artifact, showKey }: { artifact: CatalogArtifact; showKey: boolean }) {
  const manifests = useStore($manifests)
  const manifest = manifests[artifact.sha256]

  return (
    <Disclosure
      standalone
      onExpandedChange={(expanded) => {
        if (expanded) loadManifest(artifact)
      }}
    >
      <DisclosureTrigger className="py-1">
        <strong>File manifest</strong>
        {showKey && <Tag>{artifact.key}</Tag>}
        {artifact.fileCount !== undefined && (
          <span className="text-fg-muted">({artifact.fileCount} files)</span>
        )}
      </DisclosureTrigger>
      <DisclosurePanel>
        {manifest === null ? (
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
  const supported = supportedPlatforms(release)
  // Sensible default: the detected platform when this release supports it,
  // otherwise the first platform it does ship for.
  const defaultTarget = supported.includes(platform) ? platform : (supported[0] ?? platform)

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
          <SplitButton
            size="sm"
            menuLabel="Choose install platform"
            subLabel={defaultTarget}
            onPress={() => addInstallFor(modId, defaultTarget, release.version)}
            onAction={(p) => addInstallFor(modId, p as Platform, release.version)}
            items={supported.map((p) => ({
              id: p,
              label: p === platform ? `for ${p} (detected)` : `for ${p}`,
              checked: p === defaultTarget,
            }))}
          >
            {installedMod ? 'switch to' : 'add to cart'}
          </SplitButton>
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
            {artifact ? (
              <Tag title="Artifact platforms">{artifact.platforms.join(' · ')}</Tag>
            ) : (
              <>
                <Badge tone="warn">no {platform} artifact</Badge>
                {release.artifacts.map((a) => (
                  <Tag key={a.key} title={`"${a.key}" artifact platforms`}>
                    {a.platforms.join(' · ')}
                  </Tag>
                ))}
              </>
            )}
          </div>

          <div className="flex flex-col">
            {release.artifacts.map((a) => (
              <ManifestSection key={a.key} artifact={a} showKey={release.artifacts.length > 1} />
            ))}
          </div>

          <ReferenceList title="Required" marker="◆" refs={release.required} />
          <ReferenceList title="Recommended" marker="◇" refs={release.recommends} />
        </div>
      </DisclosurePanel>
    </Disclosure>
  )
}
