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

// Lanes render incrementally; handles to each lane's track/meta by session_id,
// plus the right edge and timestamp of its last chip (for burst-nudging,
// connectors, and labeled idle gaps)
const laneEls = new Map<
  string,
  { track: HTMLElement; meta: HTMLElement; lastRight: number | null; lastMs: number | null }
>()

// Event-driven time axis: pixels accrue with events at PX_PER_SEC, but idle
// stretches compress to at most GAP_MAX_PX — so the head never creeps away on
// its own, and bursts never leave "now" behind.
const PX_PER_SEC = 40
const GAP_MAX_PX = 120 // an idle gap renders at most this wide
const AXIS_TAIL = 140 // breathing room past the head so the newest chip isn't flush
const CHIP_GAP = 8 // min spacing when a burst would overlap chips
const GAP_LABEL_MS = 30_000 // lane idle gaps at least this long get a labeled break
const GAP_LABEL_PX = 56 // min rendered width so the gap label fits

// One anchor per event (piecewise time→x mapping), plus each event's x
let anchors: { ms: number; x: number }[] = []
const chipX = new WeakMap<EnrichedEvent, number>()

function anchorAppend(e: EnrichedEvent): number {
  const ms = eventMs(e)
  const last = anchors[anchors.length - 1]
  const dx = last ? Math.min(Math.max(((ms - last.ms) / 1000) * PX_PER_SEC, 0), GAP_MAX_PX) : 0
  const x = last ? last.x + dx : 0
  anchors.push({ ms, x })
  chipX.set(e, x)
  return x
}

/** Right end of the axis: the capped clock position, or the newest chip edge
 *  if a burst has nudged past it — "now" always hugs the content. */
function axisHeadX(): number {
  const last = anchors[anchors.length - 1]
  if (!last) return 0
  let head =
    last.x + Math.min(Math.max(((Date.now() - last.ms) / 1000) * PX_PER_SEC, 0), GAP_MAX_PX)
  for (const lane of laneEls.values()) {
    if (lane.lastRight !== null) head = Math.max(head, lane.lastRight)
  }
  return head
}

/** Inverse mapping for ruler labels: what moment does pixel x represent? */
function timeAtX(x: number): number | null {
  if (anchors.length === 0) return null
  if (x <= anchors[0].x) return anchors[0].ms
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]
    const b = anchors[i + 1]
    if (x <= b.x) {
      return b.x === a.x ? b.ms : a.ms + ((x - a.x) / (b.x - a.x)) * (b.ms - a.ms)
    }
  }
  const last = anchors[anchors.length - 1]
  return Math.min(last.ms + ((x - last.x) / PX_PER_SEC) * 1000, Date.now())
}
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
  lanesScroller: null as HTMLElement | null,
  lanesPill: null as HTMLButtonElement | null,
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

// Shared-scroller live-follow state for the lanes view
let lanesUnseen = 0
let lanesFollowingLive = false
let lanesFollowingTimeout: ReturnType<typeof setTimeout> | undefined

function lanesAtLiveEdge(): boolean {
  const sc = DOM.lanesScroller
  if (!sc) return true
  return sc.scrollLeft >= sc.scrollWidth - sc.clientWidth - 2
}

function clearLanesPill(): void {
  lanesUnseen = 0
  if (DOM.lanesPill) DOM.lanesPill.hidden = true
}

function showLanesPill(): void {
  const pill = DOM.lanesPill
  if (!pill) return
  pill.textContent = `${lanesUnseen} new ${lanesUnseen === 1 ? 'event' : 'events'} →`
  pill.hidden = false
}

function updateLanesMask(): void {
  const sc = DOM.lanesScroller
  if (!sc || !DOM.viewLanes) return
  DOM.viewLanes.classList.toggle(
    'mask-right',
    sc.scrollLeft < sc.scrollWidth - sc.clientWidth - 1
  )
}

function eventMs(e: EnrichedEvent): number {
  return new Date(e.timestamp).getTime()
}

function lanesAxisWidth(): number {
  // At least the visible area (minus head column) so the ruler border spans it
  const headSpan = 174 + 14
  const minVisible = (DOM.lanesScroller?.clientWidth ?? 0) - headSpan
  return Math.max(200, minVisible, axisHeadX() + AXIS_TAIL)
}

/** Size the ruler and every lane track to the current axis width. */
function applyLanesAxis(): void {
  const w = lanesAxisWidth()
  if (DOM.lanesRulerEl) DOM.lanesRulerEl.style.width = `${w}px`
  for (const lane of laneEls.values()) {
    lane.track.style.width = `${w}px`
  }
}

// Ruler label spacing in pixels; times come from the inverse axis mapping
const TICK_SPACING_PX = 240

function renderLanesRuler(): void {
  const rulerEl = DOM.lanesRulerEl
  if (!rulerEl) return

  rulerEl.innerHTML = ''
  if (anchors.length === 0) return

  const headX = axisHeadX()
  let prevLabel = ''
  for (let x = 0; x <= headX - 70; x += TICK_SPACING_PX) {
    const ms = timeAtX(x)
    if (ms === null) continue
    const label = new Date(ms).toLocaleTimeString('en-US', { hour12: false })
    if (label === prevLabel) continue // compressed gaps can repeat a second
    prevLabel = label
    rulerEl.appendChild(
      createElement('span', { class: 'trace-time', style: { left: `${x}px` } }, [label])
    )
  }
  rulerEl.appendChild(
    createElement('span', { class: 'trace-time', style: { left: `${headX}px` } }, ['now'])
  )
}

function buildLaneChip(e: EnrichedEvent, animate: boolean): HTMLElement {
  // Compact display name keeps chips narrow so bursts stay near their true
  // time position; the full name lives in the tooltip
  const full = eventName(e)
  const short = full.startsWith('mcp__') ? full.split('__').pop() || full : full
  return createElement('div', { class: animate ? 'ev ev-in' : 'ev', title: full }, [
    createElement('span', { class: 'evb' }, [eventBadge(e)]),
    createElement('span', { class: 'ev-name' }, [short]),
  ])
}

/** Compact duration for gap labels: 45s, 12m, 1h 30m. */
function fmtGap(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

/**
 * Place a chip at its true time position (nudged right if a burst would
 * overlap the previous chip) and wire a connector back to it. The chip is
 * measured after insertion, so call with it already in the track.
 */
function placeLaneChip(
  lane: { track: HTMLElement; lastRight: number | null; lastMs: number | null },
  chip: HTMLElement,
  e: EnrichedEvent
): void {
  const trueX = chipX.get(e) ?? 0
  // Long idle gaps get a labeled break, which needs room even when the
  // compressed axis (or a wide previous chip) would leave none
  const gapMs = lane.lastMs !== null ? eventMs(e) - lane.lastMs : 0
  const isBreak = gapMs >= GAP_LABEL_MS
  const minGap = isBreak ? GAP_LABEL_PX : CHIP_GAP
  const x = lane.lastRight === null ? Math.max(0, trueX) : Math.max(trueX, lane.lastRight + minGap)

  if (lane.lastRight !== null && x - lane.lastRight > 14) {
    const left = `${lane.lastRight + 3}px`
    const width = `${x - lane.lastRight - 6}px`
    lane.track.insertBefore(
      isBreak
        ? createElement('div', { class: 'ev-gap', 'aria-hidden': 'true', style: { left, width } }, [
            createElement('span', {}, [fmtGap(gapMs)]),
          ])
        : createElement('div', {
            class: 'ev-thread',
            'aria-hidden': 'true',
            style: { left, width },
          }),
      chip
    )
  }

  chip.style.left = `${x}px`
  lane.lastRight = x + chip.offsetWidth
  lane.lastMs = eventMs(e)

  // Absorb burst-nudge drift into the axis: this event was just anchored last,
  // so moving its anchor keeps the time→x mapping monotonic and label-covered
  const a = anchors[anchors.length - 1]
  if (a && x > a.x) {
    a.x = x
    chipX.set(e, x)
  }
}

/** Full rebuild (init, view switch, new session) — lands pinned to the live edge. */
function renderLanes(): void {
  const listEl = DOM.lanesListEl
  if (!listEl) return

  const sc = DOM.lanesScroller
  const wasPinned = lanesFollowingLive || lanesAtLiveEdge()
  const prevScroll = sc?.scrollLeft ?? 0
  // Where the new axis origin (oldest retained event) sat on the old axis
  const prevOriginX = eventLog.length > 0 ? chipX.get(eventLog[0]) : undefined

  anchors = []
  laneEls.clear()
  clearLanesPill()
  listEl.innerHTML = ''

  if (sessions.size === 0) {
    listEl.appendChild(createElement('div', { class: 'empty-state' }, ['No active sessions']))
    updateLanesMask()
    return
  }

  // One lane per session; tracks first so the axis width applies before placing
  for (const s of sessions.values()) {
    const track = createElement('div', { class: 'lane-track' }, [])
    const meta = createElement('div', { class: 'lane-meta' }, [
      `${s.machine_id || 'unknown'} · ${s.event_count || 0}`,
    ])

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
          meta,
        ]),
        track,
      ])
    )

    laneEls.set(s.session_id, { track, meta, lastRight: null, lastMs: null })
  }

  // Which events each lane actually displays (last N per session)
  const kept = new Map<string, Set<EnrichedEvent>>()
  for (const s of sessions.values()) {
    kept.set(
      s.session_id,
      new Set(eventLog.filter((e) => e.session_id === s.session_id).slice(-MAX_LANE_CHIPS))
    )
  }

  // Anchor and place in global event order so nudge drift folds into the axis
  for (const e of eventLog) {
    anchorAppend(e)
    const lane = laneEls.get(e.session_id)
    if (!lane || !kept.get(e.session_id)?.has(e)) continue
    const chip = buildLaneChip(e, false)
    lane.track.appendChild(chip)
    placeLaneChip(lane, chip, e)
  }

  applyLanesAxis()
  renderLanesRuler()

  if (sc) {
    if (wasPinned || prevOriginX === undefined) {
      sc.scrollLeft = sc.scrollWidth
    } else {
      // Axis origin may have advanced (log trimmed); keep the same moment in view
      sc.scrollLeft = Math.max(0, prevScroll - prevOriginX)
    }
  }
  updateLanesMask()
}

/**
 * Incrementally append one chip to its lane. Pinned-to-live readers follow the
 * right edge; scrolled-back readers keep their place and get a pill.
 */
function appendLaneChip(event: EnrichedEvent): void {
  const s = sessions.get(event.session_id)
  if (!s) return

  const lane = laneEls.get(event.session_id)
  if (!lane || anchors.length === 0) {
    // New session (or first render) — needs a full build
    renderLanes()
    return
  }

  lane.meta.textContent = `${s.machine_id || 'unknown'} · ${s.event_count || 0}`

  const pinned = lanesFollowingLive || lanesAtLiveEdge()

  anchorAppend(event)
  const chip = buildLaneChip(event, true)
  lane.track.appendChild(chip)
  placeLaneChip(lane, chip, event)
  applyLanesAxis()

  // Trim oldest chips beyond the cap (absolute layout: nothing shifts).
  // DOM order is [chip, connector, chip, ...] — a connector (plain thread or
  // labeled gap) precedes its chip.
  while (lane.track.querySelectorAll('.ev').length > MAX_LANE_CHIPS) {
    lane.track.firstElementChild?.remove()
    const next = lane.track.firstElementChild
    if (next?.classList.contains('ev-thread') || next?.classList.contains('ev-gap')) {
      next.remove()
    }
  }

  renderLanesRuler()

  const sc = DOM.lanesScroller
  if (pinned && sc) {
    sc.scrollLeft = sc.scrollWidth
  } else {
    lanesUnseen++
    showLanesPill()
  }
  updateLanesMask()
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
  const trimmed = eventLog.length > MAX_LOG_ITEMS * 2
  if (trimmed) {
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
  } else if (trimmed) {
    // Rebase the axis on log trim: reclaims the trimmed events' pixels and
    // keeps the anchor list bounded (renderLanes includes this event).
    // Carry the unseen count across the rebuild for scrolled-back readers.
    const unseen = lanesUnseen
    renderLanes()
    if (!lanesFollowingLive && !lanesAtLiveEdge()) {
      lanesUnseen = unseen + 1
      showLanesPill()
    }
  } else {
    appendLaneChip(event)
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
  DOM.lanesScroller = document.getElementById('lanes-scroller')
  DOM.lanesPill = document.getElementById('lanes-pill') as HTMLButtonElement
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

  // Lanes: reaching the live (right) edge clears the pill; clicking eases over
  DOM.lanesScroller?.addEventListener('scroll', () => {
    if (lanesAtLiveEdge()) {
      lanesFollowingLive = false
      clearLanesPill()
    }
    updateLanesMask()
  })
  DOM.lanesPill?.addEventListener('click', () => {
    clearLanesPill()
    lanesFollowingLive = true
    clearTimeout(lanesFollowingTimeout)
    lanesFollowingTimeout = setTimeout(() => {
      lanesFollowingLive = false
    }, 1500)
    const sc = DOM.lanesScroller
    sc?.scrollTo({ left: sc.scrollWidth, behavior: 'smooth' })
  })

  // Nudge the axis head between events while lanes are visible. The head only
  // moves until the current idle gap hits its cap, then this becomes a no-op.
  let lastTickHead = -1
  setInterval(() => {
    if (view !== 'lanes' || anchors.length === 0 || sessions.size === 0) return
    const head = axisHeadX()
    if (head === lastTickHead) return
    lastTickHead = head
    const pinned = lanesFollowingLive || lanesAtLiveEdge()
    applyLanesAxis()
    renderLanesRuler()
    if (pinned && DOM.lanesScroller) {
      DOM.lanesScroller.scrollLeft = DOM.lanesScroller.scrollWidth
    }
    updateLanesMask()
  }, 1000)

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
