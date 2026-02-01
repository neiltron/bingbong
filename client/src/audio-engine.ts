import type { SoundConfig, BingbongEvent } from './types';
import { SOUND_CONFIG, NOTE_FREQ } from './config';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private muted = false;
  private volume = 0.7;
  private reverbAmount = 0.3;

  async init(): Promise<void> {
    if (this.ctx) return;

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Create master gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.volume;

    // Create reverb path
    this.convolver = this.ctx.createConvolver();
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = this.reverbAmount;

    this.dryGain = this.ctx.createGain();
    this.dryGain.gain.value = 1 - this.reverbAmount;

    // Generate impulse response for reverb
    await this.createReverbImpulse();

    // Connect: source -> [dry + reverb] -> master -> output
    this.convolver.connect(this.reverbGain);
    this.reverbGain.connect(this.masterGain);
    this.dryGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
  }

  private async createReverbImpulse(): Promise<void> {
    if (!this.ctx || !this.convolver) return;

    const duration = 2;
    const decay = 2;
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * duration;
    const impulse = this.ctx.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }

    this.convolver.buffer = impulse;
  }

  setVolume(value: number): void {
    this.volume = value;
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : value;
    }
  }

  setReverb(value: number): void {
    this.reverbAmount = value;
    if (this.reverbGain && this.dryGain) {
      this.reverbGain.gain.value = value;
      this.dryGain.gain.value = 1 - value * 0.5;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
    }
    return this.muted;
  }

  playSound(config: SoundConfig, pan = 0): void {
    if (!this.ctx || this.muted || !this.dryGain || !this.convolver) return;

    const now = this.ctx.currentTime;
    const notes = config.notes || [config.note!];

    notes.forEach((note, i) => {
      const freq = NOTE_FREQ[note] || 440;
      const delay = i * 0.05; // Slight delay for chords

      // Create oscillator
      const osc = this.ctx!.createOscillator();
      osc.type = config.type || 'sine';
      osc.frequency.value = freq;

      // Create gain for envelope
      const gainNode = this.ctx!.createGain();
      gainNode.gain.value = 0;

      // Create panner
      const panner = this.ctx!.createStereoPanner();
      panner.pan.value = pan;

      // Connect: osc -> gain -> panner -> [dry + convolver]
      osc.connect(gainNode);
      gainNode.connect(panner);
      panner.connect(this.dryGain!);
      panner.connect(this.convolver!);

      // Envelope
      const attackTime = 0.01;
      const gain = config.gain || 0.2;

      gainNode.gain.setValueAtTime(0, now + delay);
      gainNode.gain.linearRampToValueAtTime(gain, now + delay + attackTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.001,
        now + delay + config.duration
      );

      // Start and stop
      osc.start(now + delay);
      osc.stop(now + delay + config.duration + 0.1);
    });
  }

  playEvent(event: BingbongEvent): void {
    const { event_type, tool_name, pan } = event;

    // Get sound config based on event type
    let config: SoundConfig;

    if (event_type === 'PreToolUse' || event_type === 'PostToolUse') {
      // Use tool-specific sound
      config =
        SOUND_CONFIG.tools[tool_name || ''] || SOUND_CONFIG.tools.default;

      // Make PostToolUse slightly different (higher pitch)
      if (event_type === 'PostToolUse' && config.note) {
        const noteKeys = Object.keys(NOTE_FREQ);
        const noteIndex = noteKeys.indexOf(config.note);
        if (noteIndex >= 0 && noteIndex < noteKeys.length - 1) {
          config = {
            ...config,
            note: noteKeys[noteIndex + 1],
          };
        }
      }
    } else {
      // Use event type sound
      config =
        (SOUND_CONFIG[event_type] as SoundConfig) || SOUND_CONFIG.tools.default;
    }

    this.playSound(config, pan || 0);
  }
}
