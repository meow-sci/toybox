/**
 * Cart-staging logic of the app store (pure state transitions — no engine,
 * no filesystem).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { app } from './toybox.svelte.ts'

beforeEach(() => {
  app.clearCart()
})

describe('cart staging', () => {
  it('stages installs and removals, replacing rather than duplicating', () => {
    app.addInstall('purrTTY')
    app.addInstall('purrTTY', '1.0.1') // re-adding pins the version
    expect(app.cartInstall).toEqual([{ id: 'purrTTY', version: '1.0.1' }])
    expect(app.inCart('purrTTY')).toBe('install')

    app.addRemove('gatOS')
    app.addRemove('gatOS')
    expect(app.cartRemove).toEqual(['gatOS'])
    expect(app.cartSize).toBe(2)
  })

  it('install and remove for the same mod are mutually exclusive', () => {
    app.addInstall('purrTTY')
    app.addRemove('purrTTY')
    expect(app.cartInstall).toEqual([])
    expect(app.cartRemove).toEqual(['purrTTY'])

    app.addInstall('purrTTY')
    expect(app.cartRemove).toEqual([])
    expect(app.inCart('purrTTY')).toBe('install')
  })

  it('drop and clear', () => {
    app.addInstall('a')
    app.addRemove('b')
    app.drop('a')
    expect(app.cartSize).toBe(1)
    app.clearCart()
    expect(app.cartSize).toBe(0)
    expect(app.inCart('b')).toBeNull()
  })

  it('staging invalidates a previously built plan', () => {
    app.planned = {} as never
    app.addInstall('x')
    expect(app.planned).toBeNull()
  })
})
