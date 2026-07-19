import './styles/main.css'
import { PROTOCOL_VERSION } from '@bingbong/protocol'
import type { EnrichedEvent, Session } from './types'
import { AudioEngine } from './audio-engine'
import { Connection } from './connection'
import { createVisualization, type SourceOverlay, type Visualizer } from './visualizer'

// ============================================
// State - lives here, passed to classes as needed
// ============================================
const sessions = new Map<string, Session>()
const eventLog: EnrichedEvent[] = []
const MAX_LOG_ITEMS = 50
const MAX_LANE_CHIPS = 30

// Per-lane horizontal scroll state, keyed by session_id. Lanes re-render on
// every event; "pinned" lanes follow the live right edge, others keep place.
const laneScroll = new Map<string, { left: number; pinned: boolean }>()
const VIEW_STORAGE_KEY = 'bingbong:view'

type TraceView = 'combined' | 'lanes'
let view: TraceView = 'combined'

let audioEngine: AudioEngine
let visualizer: Visualizer
let sourceOverlay: SourceOverlay
let connection: Connection

// ============================================
// DOM cache - populated once on DOMContentLoaded
// ============================================
const DOM = {
  sessionsEl: null as HTMLElement | null,
  traceEl: null as HTMLElement | null,
  tracePill: null as HTMLButtonElement | null,
  lanesListEl: null as HTMLElement | null,
  lanesRulerEl: null as HTMLElement | null,
  railLabel: null as HTMLElement | null,
  viewTitle: null as HTMLElement | null,
  viewCaption: null as HTMLElement | null,
  viewCombined: null as HTMLElement | null,
  viewLanes: null as HTMLElement | null,
  segCombined: null as HTMLButtonElement | null,
  segLanes: null as HTMLButtonElement | null,
  connectBtn: null as HTMLButtonElement | null,
  statusDot: null as HTMLElement | null,
  statusText: null as HTMLElement | null,
  muteBtn: null as HTMLButtonElement | null,
  volumeInput: null as HTMLInputElement | null,
  volumeVal: null as HTMLElement | null,
  volumeModalInput: null as HTMLInputElement | null,
  volumeModalVal: null as HTMLElement | null,
  reverbInput: null as HTMLInputElement | null,
  reverbVal: null as HTMLElement | null,
  audioBanner: null as HTMLElement | null,
  radarModal: null as HTMLElement | null,
  radarCaption: null as HTMLElement | null,
}

// ============================================
// Helper to create elements safely
// ============================================
function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | Record<string, string>> = {},
  children: (string | Node | null)[] = []
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value)
    } else if (key.startsWith('data-')) {
      el.dataset[key.slice(5)] = value as string
    } else {
      el.setAttribute(key, value as string)
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child))
    } else if (child) {
      el.appendChild(child)
    }
  }
  return el
}

// ============================================
// Event display helpers
// ============================================
function sessionName(s: Session): string {
  return s.label || s.session_id.slice(0, 12) + '...'
}

function eventBadge(e: EnrichedEvent): string {
  return e.tool_name ? 'tool' : 'hook'
}

function eventName(e: EnrichedEvent): string {
  return e.tool_name || e.event_type || 'Unknown'
}

function eventAgent(e: EnrichedEvent): string {
  const s = sessions.get(e.session_id)
  return s ? sessionName(s) : e.session_label || ''
}

/** Short right-aligned detail derived from tool input (command, file, pattern). */
function eventDetail(e: EnrichedEvent): string {
  const input = e.tool_input
  if (!input) return ''
  const candidate = input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.action
  if (typeof candidate !== 'string' || candidate.length === 0) return ''
  const value = candidate.includes('/') && !candidate.includes(' ')
    ? candidate.split('/').pop() || candidate
    : candidate
  return value.length > 32 ? value.slice(0, 31) + '…' : value
}

function eventTime(e: EnrichedEvent): string {
  return e.timestamp ? new Date(e.timestamp).toLocaleTimeString('en-US', { hour12: false }) : ''
}

// ============================================
// UI Updates
// ============================================
function updateCaptions(): void {
  const n = sessions.size
  if (DOM.viewCaption) DOM.viewCaption.textContent = `${n} ACTIVE · LIVE`
  if (DOM.railLabel) DOM.railLabel.textContent = `SESSIONS · ${n}`
  if (DOM.radarCaption) {
    DOM.radarCaption.textContent = `${n} SOURCES · LISTENER CENTER`
  }
}

function renderSessionsRail(): void {
  const el = DOM.sessionsEl
  if (!el) return
  el.innerHTML = ''

  if (sessions.size === 0) {
    el.appendChild(
      createElement('div', { class: 'empty-state', role: 'listitem' }, ['No active sessions'])
    )
    return
  }

  for (const s of sessions.values()) {
    el.appendChild(
      createElement('div', { class: 'agent-session agent-session--compact', role: 'listitem' }, [
        createElement(
          'div',
          {
            class: 'agent-session-indicator',
            style: { background: s.color, color: 'var(--color-text-inverse)' },
            'aria-hidden': 'true',
          },
          [sessionName(s).charAt(0).toUpperCase()]
        ),
        createElement('div', { class: 'agent-session-info' }, [
          createElement('div', { class: 'agent-session-name', title: s.session_id }, [
            sessionName(s),
          ]),
          createElement('div', { class: 'agent-session-meta' }, [
            `${s.machine_id || 'unknown'} · ${s.event_count || 0} calls`,
          ]),
        ]),
      ])
    )
  }
}

function buildTraceRow(e: EnrichedEvent, animate: boolean): HTMLElement {
  return createElement('div', { class: animate ? 'trace-row trace-row-in' : 'trace-row' }, [
    createElement('span', { class: 'trace-time' }, [eventTime(e)]),
    createElement('div', { class: 'tool-event' }, [
      createElement('span', { class: 'tool-event-badge' }, [eventBadge(e)]),
      createElement('span', { class: 'tool-event-name' }, [eventName(e)]),
      createElement('span', { class: 'tool-event-agent' }, [eventAgent(e)]),
      createElement('span', { class: 'tool-event-time' }, [eventDetail(e)]),
    ]),
  ])
}

/** Full rebuild (init, reconnect, view switch) — rows appear without animation. */
function renderTraceStream(): void {
  const el = DOM.traceEl
  if (!el) return
  el.innerHTML = ''
  clearTracePill()

  if (eventLog.length === 0) {
    el.appendChild(createElement('div', { class: 'empty-state' }, ['Waiting for events...']))
    return
  }

  for (const e of eventLog.slice(-MAX_LOG_ITEMS).reverse()) {
    el.appendChild(buildTraceRow(e, false))
  }
  el.scrollTop = 0
}

// Count of events that arrived while the user was scrolled away from the top
let unseenEvents = 0

// True while smooth-scrolling back to the live edge after a pill click, so
// events arriving mid-flight don't re-show the pill or fight the easing
let followingLive = false
let followingLiveTimeout: ReturnType<typeof setTimeout> | undefined

function clearTracePill(): void {
  unseenEvents = 0
  if (DOM.tracePill) DOM.tracePill.hidden = true
}

function showTracePill(): void {
  const pill = DOM.tracePill
  if (!pill) return
  pill.textContent = `↑ ${unseenEvents} new ${unseenEvents === 1 ? 'event' : 'events'}`
  pill.hidden = false
}

/**
 * Incrementally prepend one event (newest-first list). Pinned-to-top readers
 * stay at the live edge; scrolled readers keep their position and get a pill.
 */
function appendTraceRow(e: EnrichedEvent): void {
  const el = DOM.traceEl
  if (!el) return

  el.querySelector('.empty-state')?.remove()

  const atTop = followingLive || el.scrollTop <= 4
  const heightBefore = el.scrollHeight
  el.prepend(buildTraceRow(e, true))
  while (el.children.length > MAX_LOG_ITEMS) {
    el.lastElementChild?.remove()
  }

  if (!atTop) {
    // Keep the reader's place: offset by exactly what was inserted above
    el.scrollTop += el.scrollHeight - heightBefore
    unseenEvents++
    showTracePill()
  }
}

function renderLanes(): void {
  const listEl = DOM.lanesListEl
  const rulerEl = DOM.lanesRulerEl
  if (!listEl || !rulerEl) return

  // Time ruler: oldest visible event → now
  rulerEl.innerHTML = ''
  const visible = eventLog.slice(-MAX_LOG_ITEMS)
  const labels: string[] = []
  if (visible.length > 1) {
    const first = new Date(visible[0].timestamp).getTime()
    const last = Date.now()
    for (let i = 0; i < 4; i++) {
      const t = new Date(first + ((last - first) * i) / 4)
      labels.push(t.toLocaleTimeString('en-US', { hour12: false }))
    }
  }
  labels.push('now')
  for (const label of labels) {
    rulerEl.appendChild(createElement('span', { class: 'trace-time' }, [label]))
  }

  // One lane per session, chips sequence-ordered (timestamp positioning is a stretch goal)
  listEl.innerHTML = ''
  if (sessions.size === 0) {
    listEl.appendChild(createElement('div', { class: 'empty-state' }, ['No active sessions']))
    return
  }

  for (const s of sessions.values()) {
    const chips: Node[] = []
    for (const e of eventLog.filter((e) => e.session_id === s.session_id).slice(-MAX_LANE_CHIPS)) {
      if (chips.length > 0) {
        chips.push(createElement('div', { class: 'ev-thread', 'aria-hidden': 'true' }, []))
      }
      chips.push(
        createElement('div', { class: 'ev' }, [
          createElement('span', { class: 'evb' }, [eventBadge(e)]),
          eventName(e),
        ])
      )
    }

    const track = createElement('div', { class: 'lane-track' }, chips)
    const trackWrap = createElement('div', { class: 'lane-track-wrap' }, [track])

    listEl.appendChild(
      createElement('div', { class: 'lane' }, [
        createElement('div', { class: 'lane-head' }, [
          createElement('div', { class: 'lane-name' }, [
            createElement('span', {
              class: 'lane-ldot',
              style: { background: s.color },
              'aria-hidden': 'true',
            }),
            sessionName(s),
          ]),
          createElement('div', { class: 'lane-meta' }, [
            `${s.machine_id || 'unknown'} · ${s.event_count || 0}`,
          ]),
        ]),
        trackWrap,
      ])
    )

    // Restore scroll: pinned lanes (default) follow the newest chip on the right
    const state = laneScroll.get(s.session_id)
    if (!state || state.pinned) {
      track.scrollLeft = track.scrollWidth
    } else {
      track.scrollLeft = state.left
    }
    updateLaneMask(track, trackWrap)

    const sessionId = s.session_id
    track.addEventListener('scroll', () => {
      const atRight = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2
      laneScroll.set(sessionId, { left: track.scrollLeft, pinned: atRight })
      updateLaneMask(track, trackWrap)
    })
  }
}

/** Show a fade at each edge of a lane that has more chips in that direction. */
function updateLaneMask(track: HTMLElement, wrap: HTMLElement): void {
  wrap.classList.toggle('mask-left', track.scrollLeft > 1)
  wrap.classList.toggle(
    'mask-right',
    track.scrollLeft < track.scrollWidth - track.clientWidth - 1
  )
}

/** Mirror live source positions into every mini-radar thumbnail. */
function renderMiniRadars(): void {
  for (const dotsEl of document.querySelectorAll<HTMLElement>('.mini-dots')) {
    dotsEl.innerHTML = ''
    for (const [, source] of sourceOverlay?.sources ?? []) {
      // Same normalized→radar mapping as SourceOverlay (radius 45% of the square)
      const left = 5 + source.pos.x * 90
      const top = 5 + source.pos.y * 90
      dotsEl.appendChild(
        createElement('div', {
          class: 'mini-dot',
          style: {
            left: `${left}%`,
            top: `${top}%`,
            background: source.session.color,
            color: source.session.color,
          },
        })
      )
    }
  }
}

function updateUI(): void {
  updateCaptions()
  renderSessionsRail()
  if (view === 'combined') {
    renderTraceStream()
  } else {
    renderLanes()
  }
  renderMiniRadars()
}

// ============================================
// View Switching
// ============================================
function setView(next: TraceView): void {
  view = next
  localStorage.setItem(VIEW_STORAGE_KEY, next)

  const combined = view === 'combined'
  if (DOM.viewCombined) DOM.viewCombined.hidden = !combined
  if (DOM.viewLanes) DOM.viewLanes.hidden = combined
  if (DOM.viewTitle) DOM.viewTitle.textContent = combined ? 'Combined trace' : 'Session traces'
  DOM.segCombined?.classList.toggle('on', combined)
  DOM.segCombined?.setAttribute('aria-selected', String(combined))
  DOM.segLanes?.classList.toggle('on', !combined)
  DOM.segLanes?.setAttribute('aria-selected', String(!combined))

  updateUI()
}

// ============================================
// Radar Modal
// ============================================
function openRadar(): void {
  if (DOM.radarModal) DOM.radarModal.hidden = false
  // Sources were positioned against a zero-size canvas while hidden
  requestAnimationFrame(() => sourceOverlay?.repositionAll())
}

function closeRadar(): void {
  if (DOM.radarModal) DOM.radarModal.hidden = true
  renderMiniRadars()
}

// ============================================
// Connection Status UI
// ============================================
function setConnected(): void {
  const { statusDot: dot, statusText: text, connectBtn: btn } = DOM
  if (dot) {
    dot.classList.add('connected')
    dot.setAttribute('aria-label', 'Connection status: connected')
  }
  if (text) text.textContent = 'Connected'
  if (btn) {
    btn.textContent = 'Disconnect'
    btn.disabled = false
  }
}

function setDisconnected(): void {
  const { statusDot: dot, statusText: text, connectBtn: btn } = DOM
  if (dot) {
    dot.classList.remove('connected')
    dot.setAttribute('aria-label', 'Connection status: disconnected')
  }
  if (text) text.textContent = 'Disconnected'
  if (btn) {
    btn.textContent = 'Connect'
    btn.disabled = false
  }
}

function setReconnecting(): void {
  const { statusDot: dot, statusText: text, connectBtn: btn } = DOM
  if (dot) {
    dot.classList.remove('connected')
    dot.setAttribute('aria-label', 'Connection status: reconnecting')
  }
  if (text) text.textContent = 'Reconnecting...'
  if (btn) {
    btn.textContent = 'Disconnect'
    btn.disabled = false
  }
}

// ============================================
// Audio Banner
// ============================================
function showAudioBanner(): void {
  if (DOM.audioBanner) {
    DOM.audioBanner.hidden = false
  }
}

function hideAudioBanner(): void {
  if (DOM.audioBanner) {
    DOM.audioBanner.hidden = true
  }
}

function onAudioBannerClick(): void {
  try {
    audioEngine.init()
    hideAudioBanner()
  } catch {
    // AudioContext failed — leave banner visible
  }
}

// ============================================
// Event Handling
// ============================================
function handleEvent(event: EnrichedEvent): void {
  const sessionKey =
    event.machine_id && event.session_id ? `${event.machine_id}:${event.session_id}` : null

  // Update session tracking
  if (event.session_id) {
    const sessionData: Session = {
      session_id: event.session_id,
      machine_id: event.machine_id,
      label: event.session_label,
      pan: event.pan,
      index: event.session_index,
      color: event.color,
      event_count: (sessions.get(event.session_id)?.event_count || 0) + 1,
    }
    sessions.set(event.session_id, sessionData)
    visualizer?.updateSession(sessionData)

    // Create source overlay if not exists
    if (sourceOverlay && sessionKey) {
      sourceOverlay.createSource(sessionData)
    }
  }

  // Add to log
  eventLog.push(event)
  if (eventLog.length > MAX_LOG_ITEMS * 2) {
    eventLog.splice(0, MAX_LOG_ITEMS)
  }

  // Play sound
  audioEngine.playEvent(event)

  // Visualize (pass sessionKey for particle positioning)
  visualizer?.addEvent(event, sessionKey)

  // Update UI incrementally: the trace stream appends rather than rebuilding
  updateCaptions()
  renderSessionsRail()
  if (view === 'combined') {
    appendTraceRow(event)
  } else {
    renderLanes()
  }
  renderMiniRadars()
}

function handleMessage(data: unknown): void {
  const msg = data as Record<string, unknown>

  // Handle init message with existing sessions
  if (msg.type === 'init' && Array.isArray(msg.sessions)) {
    if (typeof msg.protocol_version === 'number' && msg.protocol_version !== PROTOCOL_VERSION) {
      console.warn(
        `[bingbong] Server speaks protocol v${msg.protocol_version}, client expects v${PROTOCOL_VERSION}`,
      )
    }
    // Full cleanup chain on reconnect
    sessions.clear()
    sourceOverlay?.clearSources()
    visualizer?.clearSessions()

    ;(msg.sessions as Session[]).forEach((s: Session) => {
      sessions.set(s.session_id, s)
      visualizer?.updateSession(s)
      if (sourceOverlay) {
        sourceOverlay.createSource(s)
      }
    })
    updateUI()
    return
  }

  // Handle enriched event
  if (msg.type === 'event' && msg.event && typeof msg.event === 'object') {
    handleEvent(msg.event as EnrichedEvent)
    return
  }

  console.warn('[bingbong] Ignoring unknown server message:', msg.type)
}

// ============================================
// Shared volume state (header + modal sliders)
// ============================================
function setVolume(value: number): void {
  audioEngine.setVolume(value / 100)
  for (const [input, val] of [
    [DOM.volumeInput, DOM.volumeVal],
    [DOM.volumeModalInput, DOM.volumeModalVal],
  ] as const) {
    if (input) {
      input.value = String(value)
      input.setAttribute('aria-valuenow', String(value))
    }
    if (val) val.textContent = String(value)
  }
}

// ============================================
// Initialize
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  // Cache DOM references
  DOM.sessionsEl = document.getElementById('sessions-list')
  DOM.traceEl = document.getElementById('trace-stream')
  DOM.tracePill = document.getElementById('trace-pill') as HTMLButtonElement
  DOM.lanesListEl = document.getElementById('lanes-list')
  DOM.lanesRulerEl = document.getElementById('lanes-ruler')
  DOM.railLabel = document.getElementById('rail-label')
  DOM.viewTitle = document.getElementById('view-title')
  DOM.viewCaption = document.getElementById('view-caption')
  DOM.viewCombined = document.getElementById('view-combined')
  DOM.viewLanes = document.getElementById('view-lanes')
  DOM.segCombined = document.getElementById('seg-combined') as HTMLButtonElement
  DOM.segLanes = document.getElementById('seg-lanes') as HTMLButtonElement
  DOM.connectBtn = document.getElementById('connect-btn') as HTMLButtonElement
  DOM.statusDot = document.getElementById('status-dot')
  DOM.statusText = document.getElementById('status-text')
  DOM.muteBtn = document.getElementById('mute-btn') as HTMLButtonElement
  DOM.volumeInput = document.getElementById('volume') as HTMLInputElement
  DOM.volumeVal = document.getElementById('volume-val')
  DOM.volumeModalInput = document.getElementById('volume-modal') as HTMLInputElement
  DOM.volumeModalVal = document.getElementById('volume-modal-val')
  DOM.reverbInput = document.getElementById('reverb') as HTMLInputElement
  DOM.reverbVal = document.getElementById('reverb-val')
  DOM.audioBanner = document.getElementById('audio-banner')
  DOM.radarModal = document.getElementById('radar-modal')
  DOM.radarCaption = document.getElementById('radar-caption')

  // Initialize audio engine
  audioEngine = new AudioEngine()

  // Initialize visualizer and source overlay (lives in the radar modal)
  const canvas = document.getElementById('visualizer') as HTMLCanvasElement
  const spatialContainer = document.getElementById('spatial-container') as HTMLElement

  const viz = createVisualization(spatialContainer, canvas, audioEngine)
  visualizer = viz.visualizer
  sourceOverlay = viz.sourceOverlay

  // Restore persisted view choice
  const savedView = localStorage.getItem(VIEW_STORAGE_KEY)
  setView(savedView === 'lanes' ? 'lanes' : 'combined')

  // Initialize connection with auto-connect
  connection = new Connection({
    onConnected: setConnected,
    onDisconnected: setDisconnected,
    onMessage: handleMessage,
    onReconnecting: setReconnecting,
  })
  connection.connect()

  // View toggle
  DOM.segCombined?.addEventListener('click', () => setView('combined'))
  DOM.segLanes?.addEventListener('click', () => setView('lanes'))

  // Trace stream: reaching the top clears the pill; clicking it eases back up
  DOM.traceEl?.addEventListener('scroll', () => {
    if (DOM.traceEl && DOM.traceEl.scrollTop <= 4) {
      followingLive = false
      clearTracePill()
    }
  })
  DOM.tracePill?.addEventListener('click', () => {
    clearTracePill()
    followingLive = true
    // Safety valve in case the user interrupts the ease before it reaches top
    clearTimeout(followingLiveTimeout)
    followingLiveTimeout = setTimeout(() => {
      followingLive = false
    }, 1500)
    DOM.traceEl?.scrollTo({ top: 0, behavior: 'smooth' })
  })

  // Radar modal: expand chips, collapse button, scrim, Esc
  for (const chip of document.querySelectorAll('.mini-expand')) {
    chip.addEventListener('click', openRadar)
  }
  document.getElementById('radar-collapse')?.addEventListener('click', closeRadar)
  document.getElementById('radar-scrim')?.addEventListener('click', closeRadar)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && DOM.radarModal && !DOM.radarModal.hidden) {
      closeRadar()
    }
  })

  // Connect/Disconnect button
  DOM.connectBtn?.addEventListener('click', () => {
    if (connection.connected) {
      connection.disconnect()
      setDisconnected()
    } else {
      connection.connect()
    }
  })

  // Audio banner (click and keyboard)
  DOM.audioBanner?.addEventListener('click', onAudioBannerClick)
  DOM.audioBanner?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onAudioBannerClick()
    }
  })

  // Show audio banner on load (audio requires user gesture)
  showAudioBanner()

  // Volume controls (header + modal, shared state)
  for (const input of [DOM.volumeInput, DOM.volumeModalInput]) {
    input?.addEventListener('input', (e) => {
      setVolume(parseInt((e.target as HTMLInputElement).value))
    })
  }

  // Reverb control (modal)
  DOM.reverbInput?.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement
    audioEngine.setReverb(parseInt(target.value) / 100)
    target.setAttribute('aria-valuenow', target.value)
    if (DOM.reverbVal) DOM.reverbVal.textContent = target.value
  })

  // Mute button
  DOM.muteBtn?.addEventListener('click', (e) => {
    const target = e.target as HTMLButtonElement
    const muted = audioEngine.toggleMute()
    target.textContent = muted ? 'Unmute' : 'Mute'
    target.classList.toggle('muted', muted)
    target.setAttribute('aria-pressed', String(muted))
  })

  // Reset layout button
  document.getElementById('reset-layout-btn')?.addEventListener('click', () => {
    sourceOverlay?.resetLayout()
    renderMiniRadars()
  })
})
