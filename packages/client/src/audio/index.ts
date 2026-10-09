/**
 * Optional Web Audio sound engine (needs AudioContext, so browser only).
 * Kept off the root export so "@bingbong/client" stays importable in Bun/Node.
 */
export { AudioEngine } from "./engine";
export { NOTE_FREQ, SOUND_CONFIG, type SoundConfig, type SoundParams } from "./config";
export { BuiltinSoundSystem } from "./builtin";
export type { ParamSpec, SoundSystem, TriggerEvent, Voice } from "./sound-system";
