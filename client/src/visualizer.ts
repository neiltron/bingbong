import type { Session, BingbongEvent, Particle } from './types';

export class Visualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private sessions = new Map<string, Session>();
  private animationId: number | null = null;
  private isAnimating = false;
  private dpr = window.devicePixelRatio || 1;
  private resizeTimeout: ReturnType<typeof setTimeout> | null = null;

  // Cache canvas dimensions (set by resize())
  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;

    this.resize();
    window.addEventListener('resize', () => this.throttledResize());
  }

  private throttledResize(): void {
    if (this.resizeTimeout) return;
    this.resizeTimeout = setTimeout(() => {
      this.resize();
      this.resizeTimeout = null;
    }, 100);
  }

  private resize(): void {
    // Get the canvas's rendered dimensions (respects CSS flex layout)
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = window.devicePixelRatio || 1;

    // Scale canvas for retina displays
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);

    // Redraw static elements after resize
    this.drawStatic();
  }

  private drawStatic(): void {
    const { ctx } = this;

    // Clear canvas
    ctx.fillStyle = '#00141f';
    ctx.fillRect(0, 0, this.width, this.height);

    // Draw center line
    ctx.strokeStyle = 'rgba(74, 74, 90, 0.3)';
    ctx.beginPath();
    ctx.moveTo(this.width / 2, 0);
    ctx.lineTo(this.width / 2, this.height);
    ctx.stroke();

    // Draw L/R labels
    ctx.fillStyle = 'rgba(74, 74, 90, 0.5)';
    ctx.font = '12px monospace';
    ctx.fillText('L', 10, 20);
    ctx.fillText('R', this.width - 20, 20);

    // Draw session positions
    for (const session of this.sessions.values()) {
      const x = ((session.pan + 1) / 2) * this.width;
      ctx.beginPath();
      ctx.arc(x, this.height - 20, 5, 0, Math.PI * 2);
      ctx.fillStyle = session.color;
      ctx.fill();
    }
  }

  addEvent(event: BingbongEvent): void {
    const { pan = 0, color, event_type, tool_name } = event;

    // Calculate x position from pan (-1 to 1 -> 0 to width)
    const x = ((pan + 1) / 2) * this.width;
    const y = this.height / 2;

    // Particle properties based on event
    let size = 20;
    let lifetime = 60;

    if (event_type === 'Stop') {
      size = 50;
      lifetime = 120;
    } else if (event_type === 'PreToolUse' || event_type === 'PostToolUse') {
      size = tool_name === 'Task' ? 35 : 15;
      lifetime = 45;
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
    });

    // Start animation if not running
    if (!this.isAnimating) {
      this.startAnimation();
    }
  }

  updateSession(session: Session): void {
    this.sessions.set(session.session_id, session);
    // Redraw static elements to show new session
    if (!this.isAnimating) {
      this.drawStatic();
    }
  }

  clearSessions(): void {
    this.sessions.clear();
    if (!this.isAnimating) {
      this.drawStatic();
    }
  }

  private startAnimation(): void {
    this.isAnimating = true;
    this.animate();
  }

  private stopAnimation(): void {
    this.isAnimating = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    // Draw final static state
    this.drawStatic();
  }

  private animate(): void {
    if (!this.isAnimating) return;

    const { ctx } = this;

    // Clear with fade effect
    ctx.fillStyle = 'rgba(10, 10, 15, 0.15)';
    ctx.fillRect(0, 0, this.width, this.height);

    // Draw center line
    ctx.strokeStyle = 'rgba(74, 74, 90, 0.3)';
    ctx.beginPath();
    ctx.moveTo(this.width / 2, 0);
    ctx.lineTo(this.width / 2, this.height);
    ctx.stroke();

    // Draw L/R labels
    ctx.fillStyle = 'rgba(74, 74, 90, 0.5)';
    ctx.font = '12px monospace';
    ctx.fillText('L', 10, 20);
    ctx.fillText('R', this.width - 20, 20);

    // Draw session positions
    for (const session of this.sessions.values()) {
      const x = ((session.pan + 1) / 2) * this.width;
      ctx.beginPath();
      ctx.arc(x, this.height - 20, 5, 0, Math.PI * 2);
      ctx.fillStyle = session.color;
      ctx.fill();
    }

    // Update and draw particles
    let activeParticles = 0;
    this.particles = this.particles.filter((p) => {
      p.lifetime--;
      if (p.lifetime <= 0) return false;

      activeParticles++;
      p.alpha = p.lifetime / p.maxLifetime;
      p.x += p.vx;
      p.y += p.vy;
      p.size *= 0.98;

      const alphaHex = Math.floor(p.alpha * 255)
        .toString(16)
        .padStart(2, '0');

      // Glow effect (drawn first, behind main circle)
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 1.5, 0, Math.PI * 2);
      ctx.fillStyle =
        p.color +
        Math.floor(p.alpha * 50)
          .toString(16)
          .padStart(2, '0');
      ctx.fill();

      // Main particle
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color + alphaHex;
      ctx.fill();

      return true;
    });

    // Stop animation when no particles
    if (activeParticles === 0) {
      this.stopAnimation();
      return;
    }

    this.animationId = requestAnimationFrame(() => this.animate());
  }
}
