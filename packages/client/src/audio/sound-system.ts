/**
 * The seam between the host (AudioEngine: context, panners, reverb, master,
 * mute) and whatever produces timbre. See issue #50.
 */

export interface ParamSpec {
  id: string
  label: string
  type: 'number' | 'boolean' | 'string'
  default: number | boolean | string
  min?: number
  max?: number
  step?: number
  options?: readonly (string | number)[]
}

/** Event fields, flat, so a patch can do its own event-to-sound mapping. */
export interface TriggerEvent {
  type: string
  tool?: string
  [key: string]: unknown
}

export interface Voice {
  trigger(event: TriggerEvent): void
  dispose(): void
}

export interface SoundSystem {
  /** Shared AudioContext; called from a user gesture. */
  start(ctx: AudioContext): Promise<void>
  /** Opaque patch document. */
  load(patch: unknown): void
  /** Drives the generated sliders UI. */
  params(): ParamSpec[]
  setParam(id: string, value: number | boolean | string): void
  /** One voice per session, wired into that session's panner. */
  createVoice(dest: AudioNode): Voice
  dispose(): void
}
