import './styles/main.css'
import type {
  ClientAudioControlMessage,
  EnrichedEvent,
  GlobalAudioConfig,
  InitPayload,
  Session,
  SessionPosition,
} from './types'
import { createVisualization, type SourceOverlay, type Visualizer } from './visualizer'

// ============================================
// State - lives here, passed to classes as needed
// ============================================
const sessions = new Map<string, Session>()
const eventLog: EnrichedEvent[] = []
const MAX_LOG_ITEMS = 50
const AUDIO_CONFIG_STORAGE_KEY = 'bingbong:audio-config:v1'

let ws: WebSocket | null = null
let visualizer: Visualizer
let sourceOverlay: SourceOverlay

const loadedAudioConfig = loadAudioConfig()
let audioConfig = loadedAudioConfig.config
const hasStoredAudioConfig = loadedAudioConfig.fromStorage

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

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function loadAudioConfig(): { config: GlobalAudioConfig; fromStorage: boolean } {
  const fallback: GlobalAudioConfig = {
    volume: 0.7,
    reverb: 0.3,
    muted: false,
  }

  try {
    const raw = localStorage.getItem(AUDIO_CONFIG_STORAGE_KEY)
    if (!raw) return { config: fallback, fromStorage: false }

    const parsed = JSON.parse(raw) as Partial<GlobalAudioConfig>
    return {
      config: {
        volume: clampUnit(typeof parsed.volume === 'number' ? parsed.volume : fallback.volume),
        reverb: clampUnit(typeof parsed.reverb === 'number' ? parsed.reverb : fallback.reverb),
        muted: typeof parsed.muted === 'boolean' ? parsed.muted : fallback.muted,
      },
      fromStorage: true,
    }
  } catch {
    return { config: fallback, fromStorage: false }
  }
}

function saveAudioConfig(): void {
  localStorage.setItem(AUDIO_CONFIG_STORAGE_KEY, JSON.stringify(audioConfig))
}

function renderAudioControls(): void {
  if (DOM.volumeInput) {
    const volumePct = Math.round(audioConfig.volume * 100)
    DOM.volumeInput.value = String(volumePct)
    DOM.volumeInput.setAttribute('aria-valuenow', String(volumePct))
  }

  if (DOM.reverbInput) {
    const reverbPct = Math.round(audioConfig.reverb * 100)
    DOM.reverbInput.value = String(reverbPct)
    DOM.reverbInput.setAttribute('aria-valuenow', String(reverbPct))
  }

  if (DOM.muteBtn) {
    DOM.muteBtn.textContent = audioConfig.muted ? 'Unmute' : 'Mute'
    DOM.muteBtn.classList.toggle('muted', audioConfig.muted)
    DOM.muteBtn.setAttribute('aria-pressed', String(audioConfig.muted))
  }
}

function setServerAudioAvailability(enabled: boolean, reason: string | null = null): void {
  const muteBtn = DOM.muteBtn
  const statusText = DOM.statusText

  if (!muteBtn || !statusText) return

  if (!enabled) {
    muteBtn.disabled = true
    muteBtn.setAttribute('aria-disabled', 'true')
    muteBtn.textContent = 'Audio unavailable'
    muteBtn.title = reason || 'Server audio backend is unavailable'

    if (DOM.statusDot?.classList.contains('connected')) {
      statusText.textContent = 'Connected (server audio unavailable)'
    }

    return
  }

  muteBtn.disabled = false
  muteBtn.removeAttribute('aria-disabled')
  muteBtn.removeAttribute('title')

  if (DOM.statusDot?.classList.contains('connected')) {
    statusText.textContent = 'Connected'
  }

  renderAudioControls()
}

function sendControlMessage(message: ClientAudioControlMessage): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify(message))
}

function pushGlobalAudioConfig(): void {
  sendControlMessage({
    type: 'audio_config:update',
    config: {
      volume: audioConfig.volume,
      reverb: audioConfig.reverb,
      muted: audioConfig.muted,
    },
  })
}

function pushSessionPosition(sessionKey: string, position: SessionPosition): void {
  sendControlMessage({
    type: 'session_config:update',
    session_key: sessionKey,
    position,
  })
}

function pushAllSessionPositions(): void {
  for (const [sessionKey, source] of sourceOverlay.sources) {
    pushSessionPosition(sessionKey, source.pos)
  }
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

  // Visualize (pass sessionKey for pulse positioning)
  visualizer?.addEvent(event, sessionKey)

  // Update UI
  updateUI()
}

// ============================================
// WebSocket Connection
// ============================================
function connect(): void {
  const { connectBtn: btn, statusDot: dot, statusText: text } = DOM
  if (!btn || !dot || !text) return

  btn.disabled = true
  btn.textContent = 'Connecting...'
  dot.setAttribute('aria-label', 'Connection status: connecting')

  try {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${protocol}://${location.host}/ws`)

    ws.onopen = () => {
      dot.classList.add('connected')
      dot.setAttribute('aria-label', 'Connection status: connected')
      text.textContent = 'Connected'
      btn.textContent = 'Disconnect'
      btn.disabled = false

      // Browser remains the configurator source of truth.
      pushGlobalAudioConfig()
      pushAllSessionPositions()
    }

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data)

        // Handle init message with existing sessions and server audio status
        if (data.type === 'init' && data.sessions) {
          const initData = data as InitPayload

          if (!hasStoredAudioConfig && initData.audio_config) {
            audioConfig = {
              volume: clampUnit(initData.audio_config.volume),
              reverb: clampUnit(initData.audio_config.reverb),
              muted: Boolean(initData.audio_config.muted),
            }
            saveAudioConfig()
            renderAudioControls()
            pushGlobalAudioConfig()
          }

          if (initData.audio_engine) {
            setServerAudioAvailability(initData.audio_engine.enabled, initData.audio_engine.reason)
          }

          initData.sessions.forEach((s: Session) => {
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

  renderAudioControls()

  // Initialize visualizer and source overlay
  const canvas = document.getElementById('visualizer') as HTMLCanvasElement
  const spatialContainer = document.getElementById('spatial-container') as HTMLElement

  const viz = createVisualization(spatialContainer, canvas, {
    onSourceReady: (sessionKey, position) => pushSessionPosition(sessionKey, position),
    onSourceMoved: (sessionKey, position) => pushSessionPosition(sessionKey, position),
  })

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
    audioConfig.volume = clampUnit(parseInt(target.value, 10) / 100)
    saveAudioConfig()
    target.setAttribute('aria-valuenow', target.value)
    sendControlMessage({ type: 'audio_config:update', config: { volume: audioConfig.volume } })
  })

  // Reverb control
  DOM.reverbInput?.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement
    audioConfig.reverb = clampUnit(parseInt(target.value, 10) / 100)
    saveAudioConfig()
    target.setAttribute('aria-valuenow', target.value)
    sendControlMessage({ type: 'audio_config:update', config: { reverb: audioConfig.reverb } })
  })

  // Mute button
  DOM.muteBtn?.addEventListener('click', (e) => {
    const target = e.target as HTMLButtonElement
    if (target.disabled) return

    audioConfig.muted = !audioConfig.muted
    saveAudioConfig()
    renderAudioControls()
    sendControlMessage({ type: 'audio_config:update', config: { muted: audioConfig.muted } })
  })

  // Reset layout button
  document.getElementById('reset-layout-btn')?.addEventListener('click', () => {
    sourceOverlay?.resetLayout()
  })
})
