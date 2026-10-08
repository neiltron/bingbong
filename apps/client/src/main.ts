import './styles/main.css'
import { BingbongClient, PROTOCOL_VERSION, sessionKey } from '@bingbong/client'
import type { EnrichedEvent, Session } from './types'
import { AudioEngine } from '@bingbong/client/audio'
import { captureHashToken, getToken, setToken } from './token'
import { createVisualization, type SourceOverlay, type Visualizer } from './visualizer'

// ============================================
// State - lives here, passed to classes as needed
// ============================================
const eventLog: EnrichedEvent[] = []

// Lanes render incrementally; handles to each lane's track/meta by sessionKey,
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
const LANE_HEAD_SPAN = 174 + 14 // sticky head column + head→track gap

// Axis breaks: an all-lanes silence at least this long stops accruing pixels
// and instead renders a fixed-width labeled corridor pushed past every chip,
// so events on either side can never read as adjacent
const BREAK_MIN_MS = 60_000
const BREAK_SPAN_PX = 72 // corridor width (duration lives in the label, not the width)
const BREAK_PAD = 12 // clearance between the corridor and chips on either side

// One anchor per event (piecewise time→x mapping), plus each event's x
let anchors: { ms: number; x: number }[] = []
let axisBreaks: { x: number; w: number; label: string }[] = []
const chipX = new WeakMap<EnrichedEvent, number>()

function anchorAppend(e: EnrichedEvent): number {
  const ms = eventMs(e)
  const last = anchors[anchors.length - 1]
  let x = 0
  if (last) {
    const gapMs = ms - last.ms
    if (gapMs >= BREAK_MIN_MS) {
      // Corridor starts past the rightmost chip in ANY lane, so pre-break
      // chips (which extend rightward from their anchors) can't reach into it
      let edge = last.x
      for (const lane of laneEls.values()) {
        if (lane.lastRight !== null) edge = Math.max(edge, lane.lastRight)
      }
      axisBreaks.push({ x: edge + BREAK_PAD, w: BREAK_SPAN_PX, label: fmtGap(gapMs) })
      x = edge + BREAK_PAD + BREAK_SPAN_PX + BREAK_PAD
    } else {
      x = last.x + Math.min(Math.max((gapMs / 1000) * PX_PER_SEC, 0), GAP_MAX_PX)
    }
  }
  anchors.push({ ms, x })
  chipX.set(e, x)
  return x
}

/** Full-height dashed corridor marking skipped time, rendered into .lanes-list. */
function buildBreakBand(b: { x: number; w: number }): HTMLElement {
  return createElement('div', {
    class: 'axis-break',
    'aria-hidden': 'true',
    style: { left: `${LANE_HEAD_SPAN + b.x}px`, width: `${b.w}px` },
  })
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

  // Ruler ticks call this repeatedly. Anchors are monotonic, so avoid scanning
  // the whole retained history for every label when a lane has thousands of
  // events.
  let low = 1
  let high = anchors.length - 1
  while (low <= high) {
    const mid = (low + high) >>> 1
    if (x <= anchors[mid].x) high = mid - 1
    else low = mid + 1
  }

  if (low < anchors.length) {
    const a = anchors[low - 1]
    const b = anchors[low]
    return a.ms + ((x - a.x) / (b.x - a.x)) * (b.ms - a.ms)
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
let client: BingbongClient // owns the session map, keyed by sessionKey(machine_id, session_id)

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
  const s = client.sessions.get(sessionKey(e.machine_id, e.session_id))
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

// Same output as toLocaleTimeString('en-US', { hour12: false }), built once
const timeFmt = new Intl.DateTimeFormat('en-US', { timeStyle: 'medium', hour12: false })

function eventTime(e: EnrichedEvent): string {
  return e.timestamp ? timeFmt.format(new Date(e.timestamp)) : ''
}

// ============================================
// UI Updates
// ============================================
function updateCaptions(): void {
  const n = client.sessions.size
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

  if (client.sessions.size === 0) {
    el.appendChild(
      createElement('div', { class: 'empty-state', role: 'listitem' }, ['No active sessions'])
    )
    return
  }

  // Mirrors the swimlane head: color dot + name, meta below, no wrapping.
  // The dot is the session's identity mark shared with lanes and the radar.
  for (const s of client.sessions.values()) {
    el.appendChild(
      createElement('div', { class: 'session-item', role: 'listitem' }, [
        createElement('div', { class: 'session-item-name', title: s.session_id }, [
          createElement('span', {
            class: 'session-dot',
            style: { background: s.color },
            'aria-hidden': 'true',
          }),
          createElement('span', { class: 'session-item-label' }, [sessionName(s)]),
        ]),
        createElement('div', { class: 'session-item-meta' }, [
          createElement('span', { class: 'session-item-machine' }, [s.machine_id || 'unknown']),
          createElement('span', { class: 'session-item-calls' }, [
            `${s.event_count || 0} ${s.event_count === 1 ? 'call' : 'calls'}`,
          ]),
        ]),
      ])
    )
  }
}

/** Split an mcp__Server__tool name into parts (null server for plain tools). */
function toolNameParts(full: string): { server: string | null; tool: string } {
  if (!full.startsWith('mcp__')) return { server: null, tool: full }
  const rest = full.slice(5)
  const i = rest.lastIndexOf('__')
  if (i === -1) return { server: null, tool: rest }
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) }
}

function buildTraceRow(e: EnrichedEvent, animate: boolean): HTMLElement {
  const full = eventName(e)
  const { server, tool } = toolNameParts(full)
  // Name column carries the actor: the MCP server for mcp__ tools, the tool
  // itself for builtins. The detail column carries the most specific context
  // available; MCP rows with none fall back to the tool name, so a row is
  // never just a bare server (builtins would only duplicate their name).
  const name = server ? server.replace(/_/g, ' ') : tool
  const detail = eventDetail(e) || (server ? tool : '')
  return createElement('div', { class: animate ? 'trace-row trace-row-in' : 'trace-row' }, [
    createElement('span', { class: 'trace-time' }, [eventTime(e)]),
    createElement('div', { class: 'tool-event' }, [
      createElement('span', { class: 'tool-event-badge' }, [eventBadge(e)]),
      createElement('span', { class: 'tool-event-name', title: full }, [name]),
      createElement('span', { class: 'tool-event-agent' }, [eventAgent(e)]),
      createElement('span', { class: 'tool-event-time' }, [detail]),
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

  for (let i = eventLog.length - 1; i >= 0; i--) {
    el.appendChild(buildTraceRow(eventLog[i], false))
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
  // Only historical readers need scroll-height compensation. Reading it at
  // the live edge would force a layout for every incoming event.
  const heightBefore = atTop ? 0 : el.scrollHeight
  el.prepend(buildTraceRow(e, true))

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
  const minVisible = (DOM.lanesScroller?.clientWidth ?? 0) - LANE_HEAD_SPAN
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
  // Only the visible window gets ticks; the scroll listener re-renders
  const sc = DOM.lanesScroller
  const from = Math.max(0, (sc?.scrollLeft ?? 0) - LANE_HEAD_SPAN - TICK_SPACING_PX)
  const to = Math.min(headX - 70, sc ? sc.scrollLeft + sc.clientWidth : Infinity)
  let prevLabel = ''
  for (let x = from - (from % TICK_SPACING_PX); x <= to; x += TICK_SPACING_PX) {
    // Interpolated times inside a break corridor are meaningless; the break
    // glyph owns that span (with padding so ticks don't crowd it)
    if (axisBreaks.some((b) => x >= b.x - 30 && x <= b.x + b.w + 30)) continue
    const ms = timeAtX(x)
    if (ms === null) continue
    const label = timeFmt.format(ms)
    if (label === prevLabel) continue // compressed gaps can repeat a second
    prevLabel = label
    rulerEl.appendChild(
      createElement('span', { class: 'trace-time', style: { left: `${x}px` } }, [label])
    )
  }
  for (const b of axisBreaks) {
    rulerEl.appendChild(
      createElement('span', {
        class: 'trace-time ruler-break',
        style: { left: `${b.x + b.w / 2}px` },
      }, [`⋯ ${b.label}`])
    )
  }
  rulerEl.appendChild(
    createElement('span', { class: 'trace-time', style: { left: `${headX}px` } }, ['now'])
  )
}

let lanesRulerFrame: number | null = null

function scheduleLanesRuler(): void {
  if (lanesRulerFrame !== null) return
  lanesRulerFrame = requestAnimationFrame(() => {
    lanesRulerFrame = null
    if (view === 'lanes') renderLanesRuler()
  })
}

function buildLaneChip(e: EnrichedEvent, animate: boolean): HTMLElement {
  // Chips stay tool-only: their width drives time-axis packing, and the
  // full name (with server) lives in the tooltip
  const full = eventName(e)
  return createElement('div', { class: animate ? 'ev ev-in' : 'ev', title: full }, [
    createElement('span', { class: 'evb' }, [eventBadge(e)]),
    createElement('span', { class: 'ev-name' }, [toolNameParts(full).tool]),
  ])
}

/**
 * Active sessions drive the rail and radar, while lane history also needs
 * sessions that disappeared from a reconnect snapshot. Enriched events carry
 * enough display metadata to reconstruct those historical lane heads.
 */
function sessionsForLanes(): Map<string, Session> {
  const result = new Map(client.sessions)

  for (const event of eventLog) {
    if (!event.session_id) continue
    const key = sessionKey(event.machine_id, event.session_id)
    const existing = result.get(key)
    if (!existing) {
      result.set(key, {
        session_id: event.session_id,
        machine_id: event.machine_id,
        label: event.session_label,
        pan: event.pan,
        index: event.session_index,
        color: event.color,
        event_count: 1,
      })
    } else if (!client.sessions.has(key)) {
      existing.event_count++
    }
  }

  return result
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
  e: EnrichedEvent,
  width?: number
): void {
  const trueX = chipX.get(e) ?? 0
  // Long idle gaps get a labeled break, which needs room even when the
  // compressed axis (or a wide previous chip) would leave none. When the gap
  // spans an axis-break corridor, the band already carries the label — keep
  // just a plain thread for lane continuity.
  const gapMs = lane.lastMs !== null ? eventMs(e) - lane.lastMs : 0
  const crossesBand =
    lane.lastRight !== null && axisBreaks.some((b) => b.x >= lane.lastRight! && b.x + b.w <= trueX)
  const isBreak = gapMs >= GAP_LABEL_MS && !crossesBand
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
  lane.lastRight = x + (width ?? chip.offsetWidth)
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
  const laneSessions = sessionsForLanes()

  const sc = DOM.lanesScroller
  const wasPinned = lanesFollowingLive || lanesAtLiveEdge()
  const prevScroll = sc?.scrollLeft ?? 0

  anchors = []
  axisBreaks = []
  laneEls.clear()
  clearLanesPill()
  listEl.innerHTML = ''

  if (laneSessions.size === 0) {
    listEl.appendChild(createElement('div', { class: 'empty-state' }, ['No active sessions']))
    updateLanesMask()
    return
  }

  // One lane per session; tracks first so the axis width applies before placing
  for (const s of laneSessions.values()) {
    const track = createElement('div', { class: 'lane-track' }, [])
    const meta = createElement('div', { class: 'lane-meta' }, [
      `${s.machine_id || 'unknown'} · ${s.event_count || 0}`,
    ])

    listEl.appendChild(
      createElement('div', { class: 'lane' }, [
        createElement('div', { class: 'lane-head' }, [
          createElement('div', { class: 'lane-name' }, [
            createElement('span', {
              class: 'session-dot',
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

    laneEls.set(sessionKey(s.machine_id, s.session_id), { track, meta, lastRight: null, lastMs: null })
  }

  // Build every chip first, then measure the batch in one layout pass. Reading
  // offsetWidth immediately after each append makes a large rebuild quadratic
  // in browser layout work.
  const pendingChips: {
    event: EnrichedEvent
    lane: { track: HTMLElement; lastRight: number | null; lastMs: number | null }
    chip: HTMLElement
  }[] = []

  for (const e of eventLog) {
    const lane = laneEls.get(sessionKey(e.machine_id, e.session_id))
    if (!lane) continue
    const chip = buildLaneChip(e, false)
    lane.track.appendChild(chip)
    pendingChips.push({ event: e, lane, chip })
  }

  const widths = pendingChips.map(({ chip }) => chip.offsetWidth)

  // Anchor and place in global event order so nudge drift folds into the axis.
  for (let i = 0; i < pendingChips.length; i++) {
    const { event, lane, chip } = pendingChips[i]
    anchorAppend(event)
    placeLaneChip(lane, chip, event, widths[i])
  }

  for (const b of axisBreaks) {
    listEl.appendChild(buildBreakBand(b))
  }

  applyLanesAxis()
  scheduleLanesRuler()

  if (sc) sc.scrollLeft = wasPinned ? sc.scrollWidth : prevScroll
  updateLanesMask()
}

/**
 * Incrementally append one chip to its lane. Pinned-to-live readers follow the
 * right edge; scrolled-back readers keep their place and get a pill.
 */
function appendLaneChip(event: EnrichedEvent): void {
  const key = sessionKey(event.machine_id, event.session_id)
  const s = client.sessions.get(key)
  if (!s) return

  const lane = laneEls.get(key)
  if (!lane || anchors.length === 0) {
    // New session (or first render) — needs a full build
    renderLanes()
    return
  }

  lane.meta.textContent = `${s.machine_id || 'unknown'} · ${s.event_count || 0}`

  const pinned = lanesFollowingLive || lanesAtLiveEdge()

  const breaksBefore = axisBreaks.length
  anchorAppend(event)
  if (axisBreaks.length > breaksBefore && DOM.lanesListEl) {
    DOM.lanesListEl.appendChild(buildBreakBand(axisBreaks[axisBreaks.length - 1]))
  }
  const chip = buildLaneChip(event, true)
  lane.track.appendChild(chip)
  placeLaneChip(lane, chip, event)
  applyLanesAxis()

  scheduleLanesRuler()

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
// Audio not yet enabled counts as muted: nothing is audible either way.
function updateTitle(): void {
  document.title = !client.connected
    ? 'bingbong (disconnected)'
    : !audioEngine.initialized || audioEngine.isMuted
      ? 'bingbong (muted)'
      : 'bingbong'
}

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
  updateTitle()
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
  updateTitle()
}

function setReconnecting(neverOpened = false): void {
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
  // Browsers hide the upgrade's 401, and a down server closes the same way; ask /sessions which it is.
  if (neverOpened && text) {
    client.fetchSessions().catch((e) => {
      // fetchSessions throws "... failed: <status>" on non-ok; a down server throws a TypeError
      if (String(e).endsWith(': 401') && text.textContent === 'Reconnecting...') {
        text.textContent = 'Unauthorized — set token in settings'
      }
    })
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
    updateTitle()
  } catch {
    // AudioContext failed — leave banner visible
  }
}

// ============================================
// Event Handling
// ============================================
// The client has already upserted the event's session into client.sessions
function handleEvent(event: EnrichedEvent): void {
  const key = sessionKey(event.machine_id, event.session_id)
  const session = client.sessions.get(key)!
  visualizer?.updateSession(session)
  sourceOverlay?.createSource(session)

  // Add to log. It's kept for the tab lifetime, so drop the raw payloads
  const { command, file_path, pattern, url, action } = event.tool_input ?? {}
  event.tool_input = { command, file_path, pattern, url, action }
  delete event.tool_output
  eventLog.push(event)

  // Play sound
  audioEngine.playEvent(event)

  // Visualize (pass the session key for particle positioning)
  visualizer?.addEvent(event, key)

  // Update UI incrementally: the trace stream appends rather than rebuilding
  updateCaptions()
  renderSessionsRail()
  if (view === 'combined') {
    appendTraceRow(event)
  } else {
    appendLaneChip(event)
  }
  renderMiniRadars()
}

// client.sessions was just replaced with this snapshot
function handleInit(snapshot: Session[]): void {
  // Full cleanup chain on reconnect
  sourceOverlay?.clearSources()
  visualizer?.clearSessions()
  for (const s of snapshot) {
    visualizer?.updateSession(s)
    sourceOverlay?.createSource(s)
  }
  updateUI()
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

  // Client before the first render: it owns the session map (token from #token=... or settings)
  captureHashToken()
  client = new BingbongClient({ url: location.origin, token: getToken() })
  client.on('connected', setConnected)
  client.on('disconnected', setDisconnected)
  client.on('reconnecting', setReconnecting)
  client.on('init', handleInit)
  client.on('event', handleEvent)
  client.on('message', (msg) => {
    if (msg.type === 'init' && msg.protocol_version !== PROTOCOL_VERSION) {
      console.warn(
        `[bingbong] Server speaks protocol v${msg.protocol_version}, client expects v${PROTOCOL_VERSION}`,
      )
    } else if (msg.type !== 'init' && msg.type !== 'event') {
      console.warn('[bingbong] Ignoring unknown server message:', (msg as { type: unknown }).type)
    }
  })

  // Restore persisted view choice
  const savedView = localStorage.getItem(VIEW_STORAGE_KEY)
  setView(savedView === 'lanes' ? 'lanes' : 'combined')

  client.connect()

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
    scheduleLanesRuler()
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
    if (view !== 'lanes' || anchors.length === 0 || client.sessions.size === 0) return
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
    if (client.connected) {
      client.disconnect()
      setDisconnected()
    } else {
      client.connect()
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

  // Server token (modal): reconnect with the new token unless the user disconnected
  const tokenInput = document.getElementById('server-token') as HTMLInputElement | null
  if (tokenInput) tokenInput.value = getToken()
  tokenInput?.addEventListener('change', () => {
    setToken(tokenInput.value.trim())
    client.setToken(getToken())
    if (client.active) client.connect()
  })

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
    updateTitle()
  })

  // Reset layout button
  document.getElementById('reset-layout-btn')?.addEventListener('click', () => {
    sourceOverlay?.resetLayout()
    renderMiniRadars()
  })
})
