import { expect, test } from 'bun:test'
import { tokenFromHash } from './token'

test('tokenFromHash', () => {
  expect(tokenFromHash('#token=s3cret')).toBe('s3cret')
  expect(tokenFromHash('token=s3cret')).toBe('s3cret')
  expect(tokenFromHash('#view=lanes&token=a%2Bb%20c')).toBe('a+b c')
  expect(tokenFromHash(`#token=${encodeURIComponent('p@ss/w&rd=')}`)).toBe('p@ss/w&rd=')
  expect(tokenFromHash('#token=')).toBeNull()
  expect(tokenFromHash('')).toBeNull()
  expect(tokenFromHash('#other=1')).toBeNull()
})
