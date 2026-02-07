import './styles/main.css'
import type { EnrichedEvent, Session } from './types'
import { AudioEngine } from './audio-engine'
import { createVisualization, type SourceOverlay, type Visualizer } from './visualizer'

// ============================================
// State - lives here, passed to classes as needed
// ============================================
const sessions = new Map<string, Session>()
const eventLog: EnrichedEvent[] = []
const MAX_LOG_ITEMS = 50

let ws: WebSocket | null = null
let audioEngine: AudioEngine
let visualizer: Visualizer
let sourceOverlay: SourceOverlay
let audioInitFailed = false

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
          createElement('div', { class: 'session-id' }, [s.session_id.slice(0, 12) + '...']),
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

// ============================================
// WebSocket Connection
// ============================================
async function connect(): Promise<void> {
  const { connectBtn: btn, statusDot: dot, statusText: text, muteBtn } = DOM
  if (!btn || !dot || !text) return

  btn.disabled = true
  btn.textContent = 'Connecting...'
  dot.setAttribute('aria-label', 'Connection status: connecting')

  try {
    // Initialize audio (requires user gesture)
    try {
      await audioEngine.init()
      audioInitFailed = false
    } catch {
      audioInitFailed = true
      // Continue without audio - show warning but don't block connection
      if (muteBtn) {
        muteBtn.textContent = 'Audio unavailable'
        muteBtn.disabled = true
        muteBtn.setAttribute('aria-disabled', 'true')
      }
    }

    // Use protocol-aware WebSocket URL
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${protocol}://${location.host}/ws`)

    ws.onopen = () => {
      dot.classList.add('connected')
      dot.setAttribute('aria-label', 'Connection status: connected')
      text.textContent = audioInitFailed ? 'Connected (no audio)' : 'Connected'
      btn.textContent = 'Disconnect'
      btn.disabled = false
    }

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data)

        // Handle init message with existing sessions
        if (data.type === 'init' && data.sessions) {
          data.sessions.forEach((s: Session) => {
            sessions.set(s.session_id, s)
            visualizer?.updateSession(s)
            // Create source overlay for existing session
            if (sourceOverlay) {
              sourceOverlay.createSource(s)
            }
          })
          updateUI()
          return
        }

        // Handle regular event
        handleEvent(data as EnrichedEvent)
      } catch {
        // Silently handle parse errors for malformed messages
      }
    }

    ws.onclose = () => {
      dot.classList.remove('connected')
      dot.setAttribute('aria-label', 'Connection status: disconnected')
      text.textContent = 'Disconnected'
      btn.textContent = 'Connect'
      btn.disabled = false
      ws = null
    }

    ws.onerror = () => {
      dot.setAttribute('aria-label', 'Connection status: error')
      text.textContent = 'Connection failed'
      btn.textContent = 'Retry'
      btn.disabled = false
    }
  } catch {
    dot.setAttribute('aria-label', 'Connection status: error')
    text.textContent = 'Connection failed'
    btn.textContent = 'Retry'
    btn.disabled = false
  }
}

function disconnect(): void {
  if (ws) {
    ws.close()
    ws = null
  }
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

  // Initialize audio engine
  audioEngine = new AudioEngine()

  // Initialize visualizer and source overlay
  const canvas = document.getElementById('visualizer') as HTMLCanvasElement
  const spatialContainer = document.getElementById('spatial-container') as HTMLElement

  const viz = createVisualization(spatialContainer, canvas, audioEngine)
  visualizer = viz.visualizer
  sourceOverlay = viz.sourceOverlay

  // Connect button
  DOM.connectBtn?.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      disconnect()
    } else {
      connect()
    }
  })

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
