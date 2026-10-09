import type { EnrichedEvent, Session, PulseRing, Position } from './types'
import type { AudioEngine } from '@bingbong/client/audio'

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
  private audioEngine: AudioEngine
  private onMove: (session: Session, x: number, y: number) => void
  sources = new Map<string, SourceData>()
  private selectedKey: string | null = null
  private dragState: DragState | null = null
  /** Dropped positions awaiting the server's echo, by session key */
  private pending = new Map<string, Position>()

  constructor(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    audioEngine: AudioEngine,
    onMove: (session: Session, x: number, y: number) => void
  ) {
    this.container = container
    this.canvas = canvas
    this.audioEngine = audioEngine
    this.onMove = onMove

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

  /** Create or refresh a session's source at its server position; true if an existing source moved */
  applySession(session: Session): boolean {
    const key = `${session.machine_id}:${session.session_id}`
    const labelText = session.label || session.session_id.slice(0, 8)
    const title = session.label
      ? `${session.label} — ${session.session_id}`
      : session.session_id || 'Unknown session'

    // Already exists — refresh the label (it can upgrade from an id
    // fallback to a project name once the server sees a cwd)
    const existing = this.sources.get(key)
    if (existing) {
      const labelEl = existing.el.querySelector('.source-label')
      if (labelEl && labelEl.textContent !== labelText) {
        labelEl.textContent = labelText
        existing.el.title = title
      }
      existing.session = session
      const { x, y } = session.position
      // Mid-drag, hold still; existing.session keeps the latest for an unmoved release
      if (this.dragState?.key === key) return false
      // After a drop, positions until the echo still carry the old spot
      const held = this.pending.get(key)
      if (held) {
        if (Math.abs(held.x - x) > 1e-6 || Math.abs(held.y - y) > 1e-6) return false
        this.pending.delete(key)
      }
      if (existing.pos.x === x && existing.pos.y === y) return false
      this.moveSource(key, existing, x, y)
      return true
    }

    const pos = { ...session.position }

    // Create element
    const el = document.createElement('div')
    el.className = 'source-circle'
    el.dataset.session = key
    el.title = title
    el.style.setProperty('--session-color', session.color)

    // Icon and label
    const icon = document.createElement('div')
    icon.className = 'source-icon'
    icon.textContent = '●'

    const label = document.createElement('div')
    label.className = 'source-label'
    label.textContent = labelText

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
    return false
  }

  private moveSource(key: string, source: SourceData, x: number, y: number): void {
    source.pos = { x, y }
    this.setElementPosition(source.el, x, y)
    this.audioEngine.updatePannerPosition(key, x, y)
  }

  private setElementPosition(el: HTMLElement, normX: number, normY: number): void {
    // Layout size, not getBoundingClientRect: the modal's entrance scale would
    // shrink the rect and skew positions computed mid-transition
    const width = this.canvas.offsetWidth
    const height = this.canvas.offsetHeight
    const size = Math.min(width, height)
    const maxRadius = size * 0.45
    const centerX = width / 2
    const centerY = height / 2

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
    if (source) this.moveSource(this.dragState.key, source, normX, normY)
  }

  private onPointerUp(_e: PointerEvent): void {
    if (!this.dragState) return
    const { key, pointerId, startPos } = this.dragState
    this.dragState = null

    const source = this.sources.get(key)
    if (!source) return
    source.el.classList.remove('dragging')
    source.el.releasePointerCapture(pointerId)
    if (source.pos.x !== startPos.x || source.pos.y !== startPos.y) {
      this.pending.set(key, { ...source.pos })
      this.onMove(source.session, source.pos.x, source.pos.y)
    } else {
      // A remote move may have landed while we held it
      this.applySession(source.session)
    }
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
    this.pending.delete(key)

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

  clearSources(): void {
    for (const [key, source] of this.sources) {
      source.el.remove()
      this.audioEngine.removePannerForSession(key)
    }
    this.sources.clear()
    this.pending.clear()
    this.selectedKey = null
  }
}

// ============================================
// Visualizer - Canvas 2D rendering
// ============================================
export class Visualizer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private pulses: PulseRing[] = []
  private animationId: number | null = null
  private isAnimating = false
  private dpr = window.devicePixelRatio || 1
  sourceOverlay: SourceOverlay | null = null

  // Cache canvas dimensions (set by resize())
  private width = 0
  private height = 0

  // Fixed font string to avoid CSS variable in canvas (which doesn't work)
  private readonly FONT = "10px 'Geist Mono', 'SF Mono', Monaco, monospace"
  private readonly MAX_ACTIVE_PULSES = 180

  private resizeRafId: number | null = null

  // Theme palette cached from CSS custom properties (canvas can't resolve var())
  private palette = {
    bg: '#12100B',
    grid: 'rgba(242, 233, 214, 0.13)',
    listener: '#F2E9D6',
    label: 'rgba(242, 233, 214, 0.5)',
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false })!

    this.readPalette()

    // Re-read palette when the theme attribute flips
    new MutationObserver(() => {
      this.readPalette()
      this.drawStatic()
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    // Use ResizeObserver with rAF to avoid "loop completed with undelivered notifications"
    new ResizeObserver(() => {
      if (this.resizeRafId) cancelAnimationFrame(this.resizeRafId)
      this.resizeRafId = requestAnimationFrame(() => {
        this.resizeRafId = null
        this.resize()
      })
    }).observe(this.canvas)
  }

  private readPalette(): void {
    const styles = getComputedStyle(document.documentElement)
    const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
    this.palette = {
      bg: read('--viz-bg', this.palette.bg),
      grid: read('--viz-grid', this.palette.grid),
      listener: read('--viz-listener', this.palette.listener),
      label: read('--viz-label', this.palette.label),
    }
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
    ctx.fillStyle = this.palette.bg
    ctx.fillRect(0, 0, this.width, this.height)

    // Draw concentric circles (distance zones)
    ctx.strokeStyle = this.palette.grid
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
    ctx.fillStyle = this.palette.listener
    ctx.beginPath()
    ctx.arc(centerX, centerY, 6, 0, Math.PI * 2)
    ctx.fill()

    // Listener label - use literal font string, not CSS variable
    ctx.fillStyle = this.palette.label
    ctx.font = this.FONT
    ctx.textAlign = 'center'
    ctx.fillText('LISTENER', centerX, centerY + 22)
  }

  addEvent(event: EnrichedEvent, sessionKey: string | null = null): void {
    const { color, event_type, tool_name } = event
    const { centerX, centerY, maxRadius } = this.getRadarGeometry()

    // Get pulse origin from source overlay or fallback to center
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

    // Pulse properties based on event type
    let baseRadius = 10
    let growthRate = 2
    let maxPulseRadius = 64
    let lifetime = 36
    let lineWidth = 2
    let pulseCount = 1

    if (event_type === 'Stop') {
      baseRadius = 14
      growthRate = 2.4
      maxPulseRadius = 110
      lifetime = 56
      lineWidth = 3
      pulseCount = 2
    } else if (event_type === 'PreToolUse' || event_type === 'PostToolUse') {
      baseRadius = tool_name === 'Task' ? 12 : 8
      growthRate = tool_name === 'Task' ? 2.2 : 1.7
      maxPulseRadius = tool_name === 'Task' ? 88 : 52
      lifetime = tool_name === 'Task' ? 44 : 30
      lineWidth = tool_name === 'Task' ? 2.6 : 1.8
    }

    for (let i = 0; i < pulseCount; i++) {
      const lifetimeOffset = i * 6
      this.pulses.push({
        x,
        y,
        radius: baseRadius + i * 4,
        growthRate,
        maxRadius: maxPulseRadius,
        lineWidth,
        color: color || '#E8A832',
        alpha: 1,
        lifetime: Math.max(8, lifetime - lifetimeOffset),
        maxLifetime: Math.max(8, lifetime - lifetimeOffset),
      })
    }

    // Avoid unbounded growth under bursty event streams
    if (this.pulses.length > this.MAX_ACTIVE_PULSES) {
      this.pulses = this.pulses.slice(-this.MAX_ACTIVE_PULSES)
    }

    // Start animation if not running
    if (!this.isAnimating) {
      this.startAnimation()
    }
  }

  clearSessions(): void {
    this.pulses = []
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

    // Redraw static radar first, then animated pulse rings
    this.drawRadarGrid()

    let activePulses = 0
    this.pulses = this.pulses.filter((p) => {
      p.lifetime--
      if (p.lifetime <= 0) return false

      p.radius += p.growthRate
      if (p.radius > p.maxRadius) return false

      p.alpha = p.lifetime / p.maxLifetime
      activePulses++

      // Outer glow ring
      ctx.save()
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
      ctx.strokeStyle = p.color
      ctx.lineWidth = p.lineWidth * 1.8
      ctx.globalAlpha = p.alpha * 0.35
      ctx.stroke()

      // Primary ring
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
      ctx.lineWidth = p.lineWidth
      ctx.globalAlpha = p.alpha
      ctx.stroke()
      ctx.restore()

      return true
    })

    // Stop animation when no pulses
    if (activePulses === 0) {
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
  audioEngine: AudioEngine,
  onMove: (session: Session, x: number, y: number) => void
): { visualizer: Visualizer; sourceOverlay: SourceOverlay } {
  const visualizer = new Visualizer(canvas)
  const sourceOverlay = new SourceOverlay(container, canvas, audioEngine, onMove)
  visualizer.sourceOverlay = sourceOverlay

  return { visualizer, sourceOverlay }
}
