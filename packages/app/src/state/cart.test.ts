/**
 * Cart-staging logic of the app store (pure state transitions — no engine,
 * no filesystem).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  $platform,
  $cartInstall,
  $cartRemove,
  $cartSize,
  $planned,
  addInstall,
  addInstallFor,
  addRemove,
  clearCart,
  dropFromCart,
  inCart,
} from './appStore.ts'

const cartState = () => [$cartInstall.get(), $cartRemove.get()] as const

beforeEach(() => {
  clearCart()
})

describe('cart staging', () => {
  it('stages installs and removals, replacing rather than duplicating', () => {
    addInstall('purrTTY')
    addInstall('purrTTY', '1.0.1') // re-adding pins the version
    expect($cartInstall.get()).toEqual([{ id: 'purrTTY', version: '1.0.1' }])
    expect(inCart(...cartState(), 'purrTTY')).toBe('install')

    addRemove('gatOS')
    addRemove('gatOS')
    expect($cartRemove.get()).toEqual(['gatOS'])
    expect($cartSize.get()).toBe(2)
  })

  it('install and remove for the same mod are mutually exclusive', () => {
    addInstall('purrTTY')
    addRemove('purrTTY')
    expect($cartInstall.get()).toEqual([])
    expect($cartRemove.get()).toEqual(['purrTTY'])

    addInstall('purrTTY')
    expect($cartRemove.get()).toEqual([])
    expect(inCart(...cartState(), 'purrTTY')).toBe('install')
  })

  it('drop and clear', () => {
    addInstall('a')
    addRemove('b')
    dropFromCart('a')
    expect($cartSize.get()).toBe(1)
    clearCart()
    expect($cartSize.get()).toBe(0)
    expect(inCart(...cartState(), 'b')).toBeNull()
  })

  it('staging invalidates a previously built plan', () => {
    $planned.set({} as never)
    addInstall('x')
    expect($planned.get()).toBeNull()
  })
})

describe('platform-targeted staging (split button)', () => {
  it('addInstallFor retargets the cart platform and stages the item', () => {
    $platform.set('linux')
    addInstallFor('gatOS', 'windows', '1.1.0')
    expect($platform.get()).toBe('windows')
    expect($cartInstall.get()).toEqual([{ id: 'gatOS', version: '1.1.0' }])
  })

  it('retargeting invalidates a previously built plan', () => {
    $planned.set({} as never)
    addInstallFor('gatOS', 'macos')
    expect($planned.get()).toBeNull()
    expect($platform.get()).toBe('macos')
  })
})
