import { expect, test } from 'bun:test'
import { getToken, setToken, tokenFromHash } from './token'

test('a failed storage write wins over a stale stored token', () => {
  const had = 'localStorage' in globalThis
  const saved = (globalThis as any).localStorage
  const throwing = () => { throw new Error('QuotaExceededError') }
  ;(globalThis as any).localStorage = { getItem: () => 'old', setItem: throwing, removeItem: throwing }
  try {
    setToken('new')
    expect(getToken()).toBe('new')
    setToken('')
    expect(getToken()).toBe('')
  } finally {
    if (had) (globalThis as any).localStorage = saved
    else delete (globalThis as any).localStorage
  }
})

test('tokenFromHash', () => {
  expect(tokenFromHash('#token=s3cret')).toBe('s3cret')
  expect(tokenFromHash('token=s3cret')).toBe('s3cret')
  expect(tokenFromHash('#view=lanes&token=a%2Bb%20c')).toBe('a+b c')
  expect(tokenFromHash(`#token=${encodeURIComponent('p@ss/w&rd=')}`)).toBe('p@ss/w&rd=')
  expect(tokenFromHash('#token=')).toBeNull()
  expect(tokenFromHash('')).toBeNull()
  expect(tokenFromHash('#other=1')).toBeNull()
})
