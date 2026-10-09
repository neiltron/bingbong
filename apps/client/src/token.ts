// Shared server token: `bingbong --open` passes it as #token=..., we keep it in localStorage.
const KEY = 'bingbong:token'
let memory = '' // fallback when localStorage throws (private mode, quota full)
let memoryWins = false // last write failed: storage may hold a stale token

export function tokenFromHash(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get('token') || null
}

/** Move #token=... from the URL into localStorage so it doesn't linger in the address bar/history. */
export function captureHashToken(): void {
  const token = tokenFromHash(location.hash)
  if (!token) return
  setToken(token)
  const rest = new URLSearchParams(location.hash.slice(1))
  rest.delete('token')
  const hash = rest.toString()
  history.replaceState(null, '', location.pathname + location.search + (hash ? `#${hash}` : ''))
}

export function getToken(): string {
  if (memoryWins) return memory
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return memory
  }
}

export function setToken(token: string): void {
  memory = token
  try {
    if (token) localStorage.setItem(KEY, token)
    else localStorage.removeItem(KEY)
    memoryWins = false
  } catch {
    // private mode / quota full: kept in memory for this page load
    memoryWins = true
  }
}
