import './styles/main.css';
import { AudioEngine } from './audio-engine';
import { Visualizer } from './visualizer';
import { initApp } from './app';

document.addEventListener('DOMContentLoaded', () => {
  // Initialize visualizer
  const canvas = document.getElementById('visualizer') as HTMLCanvasElement;
  const visualizer = new Visualizer(canvas);

  // Initialize audio engine
  const audioEngine = new AudioEngine();

  // Initialize app
  initApp(canvas, audioEngine, visualizer);
});
