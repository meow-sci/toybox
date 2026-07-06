import { useStore } from '@nanostores/react'
import { formatDate } from '../lib/format.ts'
import {
  $cartInstall,
  $cartRemove,
  $index,
  $installed,
  $query,
  $selectedModId,
  inCart,
  installedById,
  $results,
  sortedReleases,
  updateAvailable,
} from '../state/appStore.ts'
import { Badge, SearchField, Tag, card } from '../ui/kit'

export function BrowseView() {
  const index = useStore($index)
  const query = useStore($query)
  const results = useStore($results)
  const installed = useStore($installed)
  const cartInstall = useStore($cartInstall)
  const cartRemove = useStore($cartRemove)

  return (
    <div>
      <div className="mb-4 flex items-center gap-3.5">
        <SearchField
          aria-label="Search mods"
          placeholder="Search mods — try 'terminal', 'qemu', or fuzzy fragments like 'ptty'…"
          value={query}
          onChange={(v) => $query.set(v)}
        />
        <span className="hidden whitespace-nowrap text-fg-muted sm:inline">
          {results.length} of {index?.mods.length ?? 0} mods
        </span>
      </div>

      {!index ? (
        <p className="text-fg-muted">Loading index…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
            {results.map((r) => {
              const installedMod = installedById(installed, r.item.id)
              const latest = sortedReleases(r.item)[0]
              const update = installedMod ? updateAvailable(index, installedMod) : null
              const carted = inCart(cartInstall, cartRemove, r.item.id)
              return (
                <button
                  key={r.item.id}
                  type="button"
                  className={`${card} flex cursor-pointer flex-col gap-1.5 px-4 py-3.5 text-left transition-colors hover:border-accent-muted`}
                  onClick={() => $selectedModId.set(r.item.id)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{r.item.name}</strong>
                    {latest && <span className="text-fg-muted">v{latest.version}</span>}
                    {installedMod &&
                      (update ? (
                        <Badge tone="warn">update → {update}</Badge>
                      ) : (
                        <Badge tone="good">installed {installedMod.version}</Badge>
                      ))}
                    {carted && <Badge tone="info">in cart: {carted}</Badge>}
                  </div>
                  <p className="m-0 line-clamp-2 text-fg-muted">{r.item.summary}</p>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {r.item.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                    <span className="ml-auto text-fg-muted">
                      {r.item.authors.join(', ')}
                      {latest?.publishedAt ? ` · ${formatDate(latest.publishedAt)}` : ''}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
          {results.length === 0 && <p className="text-fg-muted">No mods match “{query}”.</p>}
        </>
      )}
    </div>
  )
}
