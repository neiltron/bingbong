import type { EnrichedEvent, Session, Particle, Position } from './types'
import type { AudioEngine } from './audio-engine'

// ============================================
// Position Manager - localStorage persistence
// ============================================
class PositionManager {
  private positions = new Map<string, { x: number; y: number; savedAt: string }>()

  constructor() {
    this.loadFromStorage()
    this.cleanupStale()
  }

  private storageKey(sessionKey: string): string {
    return `bingbong:position:${sessionKey}`
  }

  private loadFromStorage(): void {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('bingbong:position:')) {
        try {
          const data = JSON.parse(localStorage.getItem(key) || '')
          const sessionKey = key.replace('bingbong:position:', '')
          this.positions.set(sessionKey, data)
        } catch {
          /* ignore corrupt data */
        }
      }
    }
  }

  savePosition(sessionKey: string, x: number, y: number): void {
    const data = { x, y, savedAt: new Date().toISOString() }
    this.positions.set(sessionKey, data)
    localStorage.setItem(this.storageKey(sessionKey), JSON.stringify(data))
  }

  getPosition(sessionKey: string, index = 0): Position {
    const saved = this.positions.get(sessionKey)
    if (saved) return { x: saved.x, y: saved.y }
    return this.autoAssign(index)
  }

  hasPosition(sessionKey: string): boolean {
    return this.positions.has(sessionKey)
  }

  private autoAssign(index: number): Position {
    // First source at center
    if (index === 0) return { x: 0.5, y: 0.5 }

    // Golden angle spiral for subsequent sources
    const angle = (index * 137.5 * Math.PI) / 180
    const ring = Math.ceil(Math.sqrt(index))
    const radius = 0.15 + ring * 0.1

    return {
      x: Math.max(0.1, Math.min(0.9, 0.5 + Math.cos(angle) * radius)),
      y: Math.max(0.1, Math.min(0.9, 0.5 + Math.sin(angle) * radius)),
    }
  }

  private cleanupStale(): void {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    for (const [key, data] of this.positions) {
      if (new Date(data.savedAt).getTime() < thirtyDaysAgo) {
        this.positions.delete(key)
        localStorage.removeItem(this.storageKey(key))
      }
    }
  }

  clearAll(): void {
    for (const key of this.positions.keys()) {
      localStorage.removeItem(this.storageKey(key))
    }
    this.positions.clear()
  }
}

// ============================================
// Source Overlay - Draggable HTML elements
// ============================================
interface SourceData {
  el: HTMLDivElement
  pos: Position
  session: Session
}

interface DragState {
  key: string
  pointerId: number
  startPos: Position
}

export class SourceOverlay {
  private container: HTMLElement
  private canvas: HTMLCanvasElement
  private positionManager: PositionManager
  private audioEngine: AudioEngine
  sources = new Map<string, SourceData>()
  private selectedKey: string | null = null
  private dragState: DragState | null = null
  private sessionIndex = 0

  constructor(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    positionManager: PositionManager,
    audioEngine: AudioEngine
  ) {
    this.container = container
    this.canvas = canvas
    this.positionManager = positionManager
    this.audioEngine = audioEngine

    // Global listeners for drag
    document.addEventListener('pointermove', (e) => this.onPointerMove(e))
    document.addEventListener('pointerup', (e) => this.onPointerUp(e))

    // Deselect on container click (not on source)
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container || e.target === this.canvas) {
        this.deselect()
      }
    })

    // Handle window resize
    window.addEventListener('resize', () => this.repositionAll())
  }

  createSource(session: Session): void {
    const key = `${session.machine_id}:${session.session_id}`

    // Skip if already exists
    if (this.sources.has(key)) {
      return
    }

    // Get or auto-assign position
    const index = this.sessionIndex++
    const pos = this.positionManager.getPosition(key, index)

    // Create element
    const el = document.createElement('div')
    el.className = 'source-circle'
    el.dataset.session = key
    el.style.setProperty('--session-color', session.color)

    // Icon and label
    const icon = document.createElement('div')
    icon.className = 'source-icon'
    icon.textContent = '●'

    const label = document.createElement('div')
    label.className = 'source-label'
    label.textContent = session.session_id.slice(0, 8)

    el.appendChild(icon)
    el.appendChild(label)

    // Position element
    this.setElementPosition(el, pos.x, pos.y)

    // Event listeners
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e, key))

    this.container.appendChild(el)
    this.sources.set(key, { el, pos, session })

    // Create panner and set initial position
    this.audioEngine.createPannerForSession(key)
    this.audioEngine.updatePannerPosition(key, pos.x, pos.y)
  }

  private setElementPosition(el: HTMLElement, normX: number, normY: number): void {
    const rect = this.canvas.getBoundingClientRect()
    const size = Math.min(rect.width, rect.height)
    const maxRadius = size * 0.45
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    // Convert normalized (0-1) to pixel position within radar
    const pixelX = centerX + (normX - 0.5) * 2 * maxRadius
    const pixelY = centerY + (normY - 0.5) * 2 * maxRadius

    el.style.left = `${pixelX}px`
    el.style.top = `${pixelY}px`
  }

  repositionAll(): void {
    for (const [, source] of this.sources) {
      this.setElementPosition(source.el, source.pos.x, source.pos.y)
    }
  }

  private onPointerDown(e: PointerEvent, key: string): void {
    e.preventDefault()
    e.stopPropagation()

    const source = this.sources.get(key)
    if (!source) return

    // Select this source
    this.select(key)

    // Start drag
    source.el.classList.add('dragging')
    source.el.setPointerCapture(e.pointerId)

    this.dragState = {
      key,
      pointerId: e.pointerId,
      startPos: { ...source.pos },
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragState) return

    const rect = this.canvas.getBoundingClientRect()
    const size = Math.min(rect.width, rect.height)
    const maxRadius = size * 0.45
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    // Calculate position relative to canvas
    const canvasX = e.clientX - rect.left
    const canvasY = e.clientY - rect.top

    // Convert to normalized coordinates
    let normX = 0.5 + (canvasX - centerX) / (2 * maxRadius)
    let normY = 0.5 + (canvasY - centerY) / (2 * maxRadius)

    // Clamp to bounds (with slight padding from edges)
    normX = Math.max(0.05, Math.min(0.95, normX))
    normY = Math.max(0.05, Math.min(0.95, normY))

    const source = this.sources.get(this.dragState.key)
    if (source) {
      source.pos = { x: normX, y: normY }
      this.setElementPosition(source.el, normX, normY)
      this.audioEngine.updatePannerPosition(this.dragState.key, normX, normY)
    }
  }

  private onPointerUp(_e: PointerEvent): void {
    if (!this.dragState) return

    const source = this.sources.get(this.dragState.key)
    if (source) {
      source.el.classList.remove('dragging')
      source.el.releasePointerCapture(this.dragState.pointerId)
      // Save position to localStorage
      this.positionManager.savePosition(this.dragState.key, source.pos.x, source.pos.y)
    }

    this.dragState = null
  }

  private select(key: string): void {
    // Deselect previous
    this.deselect()

    // Select new
    this.selectedKey = key
    const source = this.sources.get(key)
    if (source) {
      source.el.classList.add('selected')
    }
  }

  private deselect(): void {
    if (this.selectedKey) {
      const prev = this.sources.get(this.selectedKey)
      if (prev) {
        prev.el.classList.remove('selected')
      }
      this.selectedKey = null
    }
  }

  removeSource(key: string): void {
    const source = this.sources.get(key)
    if (!source) return

    // Fade out then remove
    source.el.classList.add('disconnected')
    setTimeout(() => {
      source.el.remove()
      this.sources.delete(key)
      this.audioEngine.removePannerForSession(key)
    }, 1000)

    // Deselect if this was selected
    if (this.selectedKey === key) {
      this.selectedKey = null
    }
  }

  resetLayout(): void {
    this.positionManager.clearAll()
    this.sessionIndex = 0

    // Reposition all sources
    for (const [key, source] of this.sources) {
      const pos = this.positionManager.getPosition(key, this.sessionIndex++)
      source.pos = pos
      this.setElementPosition(source.el, pos.x, pos.y)
      this.audioEngine.updatePannerPosition(key, pos.x, pos.y)
      this.positionManager.savePosition(key, pos.x, pos.y)
    }
  }
}

// ============================================
// Visualizer - Canvas 2D rendering
// ============================================
export class Visualizer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private particles: Particle[] = []
  private sessions = new Map<string, Session>()
  private animationId: number | null = null
  private isAnimating = false
  private dpr = window.devicePixelRatio || 1
  private resizeTimeout: ReturnType<typeof setTimeout> | null = null
  sourceOverlay: SourceOverlay | null = null

  // Cache canvas dimensions (set by resize())
  private width = 0
  private height = 0

  // Fixed font string to avoid CSS variable in canvas (which doesn't work)
  private readonly FONT = "10px 'SF Mono', Monaco, Inconsolata, 'Roboto Mono', monospace"

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false })!

    this.resize()
    window.addEventListener('resize', () => this.throttledResize())
  }

  private throttledResize(): void {
    if (this.resizeTimeout) return
    this.resizeTimeout = setTimeout(() => {
      this.resize()
      this.resizeTimeout = null
    }, 100)
  }

  private resize(): void {
    // Get the canvas's rendered dimensions (respects CSS flex layout)
    const rect = this.canvas.getBoundingClientRect()
    this.width = rect.width
    this.height = rect.height
    this.dpr = window.devicePixelRatio || 1

    // Scale canvas for retina displays
    this.canvas.width = this.width * this.dpr
    this.canvas.height = this.height * this.dpr
    this.ctx.scale(this.dpr, this.dpr)

    // Redraw static elements after resize
    this.drawStatic()
  }

  private drawStatic(): void {
    this.drawRadarGrid()
  }

  // Get radar grid geometry (used by both canvas and overlay positioning)
  getRadarGeometry(): { size: number; centerX: number; centerY: number; maxRadius: number } {
    const size = Math.min(this.width, this.height)
    const centerX = this.width / 2
    const centerY = this.height / 2
    const maxRadius = size * 0.45 // Leave padding for source circles
    return { size, centerX, centerY, maxRadius }
  }

  private drawRadarGrid(): void {
    const { ctx } = this
    const { centerX, centerY, maxRadius } = this.getRadarGeometry()

    // Clear canvas
    ctx.fillStyle = '#00141f'
    ctx.fillRect(0, 0, this.width, this.height)

    // Draw concentric circles (distance zones)
    ctx.strokeStyle = 'rgba(42, 42, 58, 0.5)'
    ctx.lineWidth = 1
    ;[0.25, 0.5, 0.75, 1].forEach((pct) => {
      ctx.beginPath()
      ctx.arc(centerX, centerY, maxRadius * pct, 0, Math.PI * 2)
      ctx.stroke()
    })

    // Draw axis crosshair lines
    ctx.beginPath()
    ctx.moveTo(centerX - maxRadius, centerY)
    ctx.lineTo(centerX + maxRadius, centerY)
    ctx.moveTo(centerX, centerY - maxRadius)
    ctx.lineTo(centerX, centerY + maxRadius)
    ctx.stroke()

    // Draw listener indicator at center
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(centerX, centerY, 6, 0, Math.PI * 2)
    ctx.fill()

    // Listener label - use literal font string, not CSS variable
    ctx.fillStyle = 'rgba(136, 136, 136, 0.7)'
    ctx.font = this.FONT
    ctx.textAlign = 'center'
    ctx.fillText('LISTENER', centerX, centerY + 22)
  }

  addEvent(event: EnrichedEvent, sessionKey: string | null = null): void {
    const { color, event_type, tool_name } = event
    const { centerX, centerY, maxRadius } = this.getRadarGeometry()

    // Get particle spawn position from source overlay or fallback to center
    let x = centerX
    let y = centerY

    if (sessionKey && this.sourceOverlay) {
      const source = this.sourceOverlay.sources.get(sessionKey)
      if (source) {
        // Convert normalized position to canvas coordinates
        x = centerX + (source.pos.x - 0.5) * 2 * maxRadius
        y = centerY + (source.pos.y - 0.5) * 2 * maxRadius
      }
    }

    // Particle properties based on event
    let size = 20
    let lifetime = 60

    if (event_type === 'Stop') {
      size = 50
      lifetime = 120
    } else if (event_type === 'PreToolUse' || event_type === 'PostToolUse') {
      size = tool_name === 'Task' ? 35 : 15
      lifetime = 45
    }

    this.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      size,
      color: color || '#4ECDC4',
      alpha: 1,
      lifetime,
      maxLifetime: lifetime,
    })

    // Start animation if not running
    if (!this.isAnimating) {
      this.startAnimation()
    }
  }

  updateSession(session: Session): void {
    this.sessions.set(session.session_id, session)
    // Redraw static elements to show new session
    if (!this.isAnimating) {
      this.drawStatic()
    }
  }

  private startAnimation(): void {
    this.isAnimating = true
    this.animate()
  }

  private stopAnimation(): void {
    this.isAnimating = false
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
    // Draw final static state
    this.drawStatic()
  }

  private animate(): void {
    if (!this.isAnimating) return

    const { ctx } = this

    // Clear with fade effect
    ctx.fillStyle = 'rgba(0, 20, 31, 0.15)'
    ctx.fillRect(0, 0, this.width, this.height)

    // Redraw radar grid (faint, under particles)
    this.drawRadarGrid()

    // Update and draw particles
    let activeParticles = 0
    this.particles = this.particles.filter((p) => {
      p.lifetime--
      if (p.lifetime <= 0) return false

      activeParticles++
      p.alpha = p.lifetime / p.maxLifetime
      p.x += p.vx
      p.y += p.vy
      p.size *= 0.98

      const alphaHex = Math.floor(p.alpha * 255)
        .toString(16)
        .padStart(2, '0')

      // Glow effect (drawn first, behind main circle)
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * 1.5, 0, Math.PI * 2)
      ctx.fillStyle =
        p.color +
        Math.floor(p.alpha * 50)
          .toString(16)
          .padStart(2, '0')
      ctx.fill()

      // Main particle
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fillStyle = p.color + alphaHex
      ctx.fill()

      return true
    })

    // Stop animation when no particles
    if (activeParticles === 0) {
      this.stopAnimation()
      return
    }

    this.animationId = requestAnimationFrame(() => this.animate())
  }
}

// Factory function to create interconnected visualization components
export function createVisualization(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  audioEngine: AudioEngine
): { visualizer: Visualizer; sourceOverlay: SourceOverlay } {
  const positionManager = new PositionManager()
  const visualizer = new Visualizer(canvas)
  const sourceOverlay = new SourceOverlay(container, canvas, positionManager, audioEngine)
  visualizer.sourceOverlay = sourceOverlay

  return { visualizer, sourceOverlay }
}
