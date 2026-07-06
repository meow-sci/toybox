import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { DEFAULT_INDEX_URL } from '@toybox/core'
import { $grant, $grantName, $settings, forget, saveSettings } from '../state/appStore.ts'
import { Button, Select, TextField, card } from '../ui/kit'

const block = `${card} px-4 py-3.5`

export function SettingsView() {
  const grant = useStore($grant)
  const grantName = useStore($grantName)
  const settings = useStore($settings)

  const [ksaVersion, setKsaVersion] = useState(settings?.ksaVersion ?? '')
  const [githubToken, setGithubToken] = useState(settings?.githubToken ?? '')
  const [indexUrl, setIndexUrl] = useState(settings?.indexUrl ?? '')

  return (
    <div className="flex max-w-2xl flex-col gap-3.5">
      <div className={block}>
        <h3 className="mt-0 font-semibold">Release channel</h3>
        <p className="text-fg-muted">Prereleases (tip builds) are hidden on the stable channel.</p>
        <Select
          aria-label="Release channel"
          options={[
            { id: 'stable', label: 'stable' },
            { id: 'prerelease', label: 'prerelease (include tip builds)' },
          ]}
          selectedKey={settings?.channel ?? 'stable'}
          onSelectionChange={(key) =>
            void saveSettings({ channel: key as 'stable' | 'prerelease' })
          }
        />
      </div>

      <div className={block}>
        <h3 className="mt-0 font-semibold">KSA game version</h3>
        <p className="text-fg-muted">
          Used to filter releases by compatibility (e.g. <code>2026.7.3.4826</code> — the third
          number is ignored, it is per-build noise). Leave empty to skip compatibility filtering.
        </p>
        <div className="flex gap-2">
          <TextField
            aria-label="KSA game version"
            placeholder="2026.7.3.4826"
            value={ksaVersion}
            onChange={setKsaVersion}
          />
          <Button
            onPress={() =>
              void saveSettings(ksaVersion ? { ksaVersion } : { ksaVersion: undefined as never })
            }
          >
            Save
          </Button>
        </div>
      </div>

      <div className={block}>
        <h3 className="mt-0 font-semibold">GitHub token (optional)</h3>
        <p className="text-fg-muted">
          Downloads use the GitHub API (60 requests/hour without a token). A fine-grained token with{' '}
          <em>no scopes</em> raises that limit. Stored only in{' '}
          <code>mods/.toybox/settings.json</code> on your disk.
        </p>
        <div className="flex gap-2">
          <TextField
            aria-label="GitHub token"
            type="password"
            placeholder="github_pat_…"
            value={githubToken}
            onChange={setGithubToken}
          />
          <Button
            onPress={() => void saveSettings({ githubToken: githubToken || (undefined as never) })}
          >
            Save
          </Button>
        </div>
      </div>

      <div className={block}>
        <h3 className="mt-0 font-semibold">Index URL</h3>
        <p className="text-fg-muted">
          Default: <code>{DEFAULT_INDEX_URL}</code>
        </p>
        <div className="flex gap-2">
          <TextField
            aria-label="Index URL"
            placeholder={DEFAULT_INDEX_URL}
            value={indexUrl}
            onChange={setIndexUrl}
          />
          <Button onPress={() => void saveSettings({ indexUrl: indexUrl || (undefined as never) })}>
            Save & reload index
          </Button>
        </div>
      </div>

      <div className={block}>
        <h3 className="mt-0 font-semibold">Folder access</h3>
        <p className="text-fg-muted">
          Managing <code>{grantName}</code> (
          {grant?.mode === 'ksa-root'
            ? 'KSA folder — manifest.toml sync enabled'
            : 'mods folder only — re-pick the parent KSA folder to enable enable/disable'}
          ).
        </p>
        <Button variant="danger" onPress={() => void forget()}>
          Forget this folder
        </Button>
      </div>
    </div>
  )
}
