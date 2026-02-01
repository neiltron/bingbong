import type { Session, BingbongEvent, InitMessage } from './types';
import { WS_URL, MAX_LOG_ITEMS } from './config';
import { AudioEngine } from './audio-engine';
import { Visualizer } from './visualizer';
import { createElement } from './dom-utils';

// App State
let ws: WebSocket | null = null;
let audioInitFailed = false;
const sessions = new Map<string, Session>();
const eventLog: BingbongEvent[] = [];

// Dependencies (set during init)
let audioEngine: AudioEngine;
let visualizer: Visualizer;

// Cached DOM references
interface DOMRefs {
  sessionsEl: HTMLElement;
  logEl: HTMLElement;
  connectBtn: HTMLButtonElement;
  statusDot: HTMLElement;
  statusText: HTMLElement;
  muteBtn: HTMLButtonElement;
  volumeInput: HTMLInputElement;
  reverbInput: HTMLInputElement;
}

let DOM: DOMRefs;

function updateUI(): void {
  // Update sessions list using safe DOM methods
  const sessionsEl = DOM.sessionsEl;
  sessionsEl.innerHTML = '';

  if (sessions.size === 0) {
    sessionsEl.appendChild(
      createElement('div', { class: 'empty-state', role: 'listitem' }, [
        'No active sessions',
      ])
    );
  } else {
    for (const s of sessions.values()) {
      const panPercent = ((s.pan + 1) / 2) * 100;
      const sessionItem = createElement(
        'div',
        { class: 'session-item', role: 'listitem' },
        [
          createElement('div', {
            class: 'session-color',
            style: { background: s.color },
            'aria-hidden': 'true',
          }),
          createElement('div', { class: 'session-info' }, [
            createElement('div', { class: 'session-id' }, [
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
        ]
      );
      sessionsEl.appendChild(sessionItem);
    }
  }

  // Update event log using safe DOM methods
  const logEl = DOM.logEl;
  logEl.innerHTML = '';

  if (eventLog.length === 0) {
    logEl.appendChild(
      createElement('div', { class: 'empty-state' }, ['Waiting for events...'])
    );
  } else {
    const recentEvents = eventLog.slice(-MAX_LOG_ITEMS).reverse();
    for (const e of recentEvents) {
      const eventChildren: (string | HTMLElement)[] = [
        createElement('span', { class: 'event-type' }, [
          e.event_type || 'Unknown',
        ]),
      ];
      if (e.tool_name) {
        eventChildren.push(
          createElement('span', { class: 'event-tool' }, [e.tool_name])
        );
      }
      eventChildren.push(
        createElement('span', { class: 'event-time' }, [
          e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '',
        ])
      );
      logEl.appendChild(
        createElement('div', { class: 'event-item' }, eventChildren)
      );
    }
  }
}

function handleEvent(event: BingbongEvent): void {
  // Update session tracking
  if (event.session_id) {
    sessions.set(event.session_id, {
      session_id: event.session_id,
      machine_id: event.machine_id,
      pan: event.pan || 0,
      color: event.color || '#4ECDC4',
      event_count: (sessions.get(event.session_id)?.event_count || 0) + 1,
    });
    visualizer.updateSession(sessions.get(event.session_id)!);
  }

  // Add to log
  eventLog.push(event);
  if (eventLog.length > MAX_LOG_ITEMS * 2) {
    eventLog.splice(0, MAX_LOG_ITEMS);
  }

  // Play sound
  audioEngine.playEvent(event);

  // Visualize
  visualizer.addEvent(event);

  // Update UI
  updateUI();
}

async function connect(): Promise<void> {
  const { connectBtn: btn, statusDot: dot, statusText: text, muteBtn } = DOM;

  btn.disabled = true;
  btn.textContent = 'Connecting...';
  dot.setAttribute('aria-label', 'Connection status: connecting');

  try {
    // Initialize audio (requires user gesture)
    try {
      await audioEngine.init();
      audioInitFailed = false;
    } catch {
      audioInitFailed = true;
      // Continue without audio - show warning but don't block connection
      muteBtn.textContent = 'Audio unavailable';
      muteBtn.disabled = true;
      muteBtn.setAttribute('aria-disabled', 'true');
    }

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      dot.classList.add('connected');
      dot.setAttribute('aria-label', 'Connection status: connected');
      text.textContent = audioInitFailed ? 'Connected (no audio)' : 'Connected';
      btn.textContent = 'Disconnect';
      btn.disabled = false;
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as BingbongEvent | InitMessage;

        // Handle init message with existing sessions
        if ('type' in data && data.type === 'init' && 'sessions' in data) {
          sessions.clear();
          visualizer.clearSessions();
          (data as InitMessage).sessions.forEach((s) => {
            sessions.set(s.session_id, s);
            visualizer.updateSession(s);
          });
          updateUI();
          return;
        }

        // Handle regular event
        handleEvent(data as BingbongEvent);
      } catch {
        // Silently handle parse errors for malformed messages
      }
    };

    ws.onclose = () => {
      dot.classList.remove('connected');
      dot.setAttribute('aria-label', 'Connection status: disconnected');
      text.textContent = 'Disconnected';
      btn.textContent = 'Connect';
      btn.disabled = false;
      ws = null;
    };

    ws.onerror = () => {
      dot.setAttribute('aria-label', 'Connection status: error');
      text.textContent = 'Connection failed';
      btn.textContent = 'Retry';
      btn.disabled = false;
    };
  } catch {
    dot.setAttribute('aria-label', 'Connection status: error');
    text.textContent = 'Connection failed';
    btn.textContent = 'Retry';
    btn.disabled = false;
  }
}

function disconnect(): void {
  if (ws) {
    ws.close();
    ws = null;
  }
}

export function initApp(
  _canvas: HTMLCanvasElement,
  audio: AudioEngine,
  vis: Visualizer
): void {
  audioEngine = audio;
  visualizer = vis;

  // Cache DOM references
  DOM = {
    sessionsEl: document.getElementById('sessions-list')!,
    logEl: document.getElementById('event-log')!,
    connectBtn: document.getElementById('connect-btn') as HTMLButtonElement,
    statusDot: document.getElementById('status-dot')!,
    statusText: document.getElementById('status-text')!,
    muteBtn: document.getElementById('mute-btn') as HTMLButtonElement,
    volumeInput: document.getElementById('volume') as HTMLInputElement,
    reverbInput: document.getElementById('reverb') as HTMLInputElement,
  };

  // Connect button
  DOM.connectBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      disconnect();
    } else {
      connect();
    }
  });

  // Volume control
  DOM.volumeInput.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    audioEngine.setVolume(parseInt(target.value, 10) / 100);
    target.setAttribute('aria-valuenow', target.value);
  });

  // Reverb control
  DOM.reverbInput.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    audioEngine.setReverb(parseInt(target.value, 10) / 100);
    target.setAttribute('aria-valuenow', target.value);
  });

  // Mute button
  DOM.muteBtn.addEventListener('click', (e) => {
    const target = e.target as HTMLButtonElement;
    const muted = audioEngine.toggleMute();
    target.textContent = muted ? 'Unmute' : 'Mute';
    target.classList.toggle('muted', muted);
    target.setAttribute('aria-pressed', String(muted));
  });
}
