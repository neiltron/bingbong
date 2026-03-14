import './styles/main.css'
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

let audioEngine: AudioEngine
let visualizer: Visualizer
let sourceOverlay: SourceOverlay
let connection: Connection

// ============================================
// DOM cache - populated once on DOMContentLoaded
// ============================================
const DOM = {
  sessionsEl: null as HTMLElement | null,
  logEl: null as HTMLElement | null,
  connectBtn: null as HTMLButtonElement | null,
  statusDot: null as HTMLElement | null,
  statusText: null as HTMLElement | null,
  muteBtn: null as HTMLButtonElement | null,
  volumeInput: null as HTMLInputElement | null,
  reverbInput: null as HTMLInputElement | null,
  audioBanner: null as HTMLElement | null,
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
// UI Updates
// ============================================
function updateUI(): void {
  const sessionsEl = DOM.sessionsEl
  if (!sessionsEl) return

  // Update sessions list
  sessionsEl.innerHTML = ''

  if (sessions.size === 0) {
    sessionsEl.appendChild(
      createElement('div', { class: 'empty-state', role: 'listitem' }, ['No active sessions'])
    )
  } else {
    for (const s of sessions.values()) {
      const panPercent = ((s.pan + 1) / 2) * 100
      const sessionItem = createElement('div', { class: 'session-item', role: 'listitem' }, [
        createElement('div', {
          class: 'session-color',
          style: { background: s.color },
          'aria-hidden': 'true',
        }),
        createElement('div', { class: 'session-info' }, [
          createElement('div', { class: 'session-id', title: s.session_id }, [
            s.session_id.slice(0, 12) + '...',
          ]),
          createElement('div', { class: 'session-meta' }, [
            `${s.machine_id || 'Unknown'} • ${s.event_count || 0} events`,
          ]),
        ]),
        createElement(
          'div',
          {
            class: 'pan-indicator',
            'aria-label': `Pan position: ${Math.round(s.pan * 100)}%`,
          },
          [
            createElement('div', {
              class: 'pan-dot',
              style: {
                left: `${panPercent}%`,
                background: s.color,
              },
            }),
          ]
        ),
      ])
      sessionsEl.appendChild(sessionItem)
    }
  }

  // Update event log
  const logEl = DOM.logEl
  if (!logEl) return

  logEl.innerHTML = ''

  if (eventLog.length === 0) {
    logEl.appendChild(createElement('div', { class: 'empty-state' }, ['Waiting for events...']))
  } else {
    const recentEvents = eventLog.slice(-MAX_LOG_ITEMS).reverse()
    for (const e of recentEvents) {
      const eventChildren: (Node | string)[] = [
        createElement('span', { class: 'event-type' }, [e.event_type || 'Unknown']),
      ]
      if (e.tool_name) {
        eventChildren.push(createElement('span', { class: 'event-tool' }, [e.tool_name]))
      }
      eventChildren.push(
        createElement('span', { class: 'event-time' }, [
          e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '',
        ])
      )
      logEl.appendChild(createElement('div', { class: 'event-item' }, eventChildren))
    }
  }
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

  // Update UI
  updateUI()
}

function handleMessage(data: unknown): void {
  const msg = data as Record<string, unknown>

  // Handle init message with existing sessions
  if (msg.type === 'init' && Array.isArray(msg.sessions)) {
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

  // Handle regular event
  handleEvent(msg as unknown as EnrichedEvent)
}

// ============================================
// Initialize
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  // Cache DOM references
  DOM.sessionsEl = document.getElementById('sessions-list')
  DOM.logEl = document.getElementById('event-log')
  DOM.connectBtn = document.getElementById('connect-btn') as HTMLButtonElement
  DOM.statusDot = document.getElementById('status-dot')
  DOM.statusText = document.getElementById('status-text')
  DOM.muteBtn = document.getElementById('mute-btn') as HTMLButtonElement
  DOM.volumeInput = document.getElementById('volume') as HTMLInputElement
  DOM.reverbInput = document.getElementById('reverb') as HTMLInputElement
  DOM.audioBanner = document.getElementById('audio-banner')

  // Initialize audio engine
  audioEngine = new AudioEngine()

  // Initialize visualizer and source overlay
  const canvas = document.getElementById('visualizer') as HTMLCanvasElement
  const spatialContainer = document.getElementById('spatial-container') as HTMLElement

  const viz = createVisualization(spatialContainer, canvas, audioEngine)
  visualizer = viz.visualizer
  sourceOverlay = viz.sourceOverlay

  // Initialize connection with auto-connect
  connection = new Connection({
    onConnected: setConnected,
    onDisconnected: setDisconnected,
    onMessage: handleMessage,
    onReconnecting: setReconnecting,
  })
  connection.connect()

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

  // Volume control
  DOM.volumeInput?.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement
    audioEngine.setVolume(parseInt(target.value) / 100)
    target.setAttribute('aria-valuenow', target.value)
  })

  // Reverb control
  DOM.reverbInput?.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement
    audioEngine.setReverb(parseInt(target.value) / 100)
    target.setAttribute('aria-valuenow', target.value)
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
  })
})
