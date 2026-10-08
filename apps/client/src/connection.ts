// ============================================
// WebSocket Connection Manager
// Owns connect/disconnect lifecycle with exponential backoff reconnection
// ============================================

import { getToken } from './token'

export interface ConnectionCallbacks {
  onConnected: () => void
  onDisconnected: () => void
  onMessage: (data: unknown) => void
  /** neverOpened: the socket closed before onopen, e.g. a 401 on the upgrade or the server being down */
  onReconnecting: (neverOpened: boolean) => void
}

export class Connection {
  private ws: WebSocket | null = null
  private shouldConnect = true
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private callbacks: ConnectionCallbacks

  constructor(callbacks: ConnectionCallbacks) {
    this.callbacks = callbacks
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /** connected or trying to (i.e. not user-disconnected) */
  get active(): boolean {
    return this.shouldConnect
  }

  connect(): void {
    this.shouldConnect = true
    this.reconnectAttempts = 0
    this.clearTimer()
    this.openWebSocket()
  }

  disconnect(): void {
    this.shouldConnect = false
    this.clearTimer()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private openWebSocket(): void {
    // Clean up any existing connection
    if (this.ws) {
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.close()
      this.ws = null
    }

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const token = getToken()
    const query = token ? `?token=${encodeURIComponent(token)}` : ''
    this.ws = new WebSocket(`${protocol}://${location.host}/ws${query}`)
    let opened = false

    this.ws.onopen = () => {
      opened = true
      this.reconnectAttempts = 0
      this.callbacks.onConnected()
    }

    this.ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data)
        this.callbacks.onMessage(data)
      } catch (e) {
        console.warn('[bingbong] Failed to parse WebSocket message:', e)
      }
    }

    // onclose is the single source of truth for reconnection.
    // onerror always fires before onclose, so we only schedule retries here.
    this.ws.onclose = () => {
      this.ws = null
      this.callbacks.onDisconnected()

      if (this.shouldConnect) {
        this.scheduleReconnect(!opened)
      }
    }

    this.ws.onerror = () => {
      // No-op: onclose handles reconnection
    }
  }

  private scheduleReconnect(neverOpened: boolean): void {
    if (!this.shouldConnect) return

    const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts))
    this.reconnectAttempts++

    this.callbacks.onReconnecting(neverOpened)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.shouldConnect) {
        this.openWebSocket()
      }
    }, delay)
  }

  private clearTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
