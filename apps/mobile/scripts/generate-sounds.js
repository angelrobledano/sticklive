import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Buffer } from 'node:buffer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SAMPLE_RATE = 44100;

function createWavBuffer(samples) {
  const byteRate = SAMPLE_RATE * 2; // 16-bit mono
  const blockAlign = 2;
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(1, 22);  // NumChannels (1 = Mono)
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // BitsPerSample

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Samples (16-bit signed integers)
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const intSample = s < 0 ? s * 32768 : s * 32767;
    buffer.writeInt16LE(Math.floor(intSample), offset);
    offset += 2;
  }

  return buffer;
}

// 1. Gol a favor: C5 -> E5 -> G5 ascending triumphant arpeggio with celebratory bell shimmer
function generateGolFavor() {
  const duration = 0.75;
  const numSamples = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float32Array(numSamples);

  const notes = [
    { freq: 523.25, start: 0.00, dur: 0.22 }, // C5
    { freq: 659.25, start: 0.15, dur: 0.25 }, // E5
    { freq: 783.99, start: 0.30, dur: 0.45 }, // G5
  ];

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    let val = 0;

    for (const note of notes) {
      if (t >= note.start && t < note.start + note.dur) {
        const localT = t - note.start;
        // Attack 15ms, exponential decay
        const env = Math.min(1, localT / 0.015) * Math.exp(-localT * 6);
        // Fundamental + harmonics for rich bell-like celebratory timbre
        const wave =
          0.60 * Math.sin(2 * Math.PI * note.freq * localT) +
          0.25 * Math.sin(2 * Math.PI * (note.freq * 2) * localT) +
          0.15 * Math.sin(2 * Math.PI * (note.freq * 3) * localT);
        val += wave * env;
      }
    }

    // Master envelope: smooth fadeout at the end
    const masterEnv = t > 0.65 ? Math.max(0, (0.75 - t) / 0.10) : 1;
    samples[i] = val * 0.85 * masterEnv;
  }

  return samples;
}

// 2. Gol en contra: E4 -> C4 soft descending chime, alerting without being harsh
function generateGolContra() {
  const duration = 0.55;
  const numSamples = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float32Array(numSamples);

  const notes = [
    { freq: 329.63, start: 0.00, dur: 0.25 }, // E4
    { freq: 261.63, start: 0.20, dur: 0.35 }, // C4
  ];

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    let val = 0;

    for (const note of notes) {
      if (t >= note.start && t < note.start + note.dur) {
        const localT = t - note.start;
        const env = Math.min(1, localT / 0.02) * Math.exp(-localT * 7);
        // Soft rounded timbre (fundamental + sub)
        const wave =
          0.75 * Math.sin(2 * Math.PI * note.freq * localT) +
          0.25 * Math.sin(2 * Math.PI * (note.freq * 0.5) * localT);
        val += wave * env;
      }
    }

    const masterEnv = t > 0.45 ? Math.max(0, (0.55 - t) / 0.10) : 1;
    samples[i] = val * 0.80 * masterEnv;
  }

  return samples;
}

// 3. Inicio del partido: crisp referee whistle with natural 28Hz acoustic beat frequency
function generatePartidoInicio() {
  const duration = 0.60;
  const numSamples = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    // Whistle attack 20ms, sustain, fadeout at 0.50s
    let env = 1;
    if (t < 0.02) env = t / 0.02;
    else if (t > 0.45) env = Math.max(0, (0.60 - t) / 0.15);

    // Two high whistle tones with tremolo (Fox 40 pea-less whistle simulation)
    const tremolo = 0.85 + 0.15 * Math.sin(2 * Math.PI * 28 * t);
    const f1 = 2650;
    const f2 = 2950;
    const tone =
      0.55 * Math.sin(2 * Math.PI * f1 * t) +
      0.45 * Math.sin(2 * Math.PI * f2 * t);

    // Tiny breath noise
    const noise = (Math.random() * 2 - 1) * 0.04;

    samples[i] = (tone + noise) * env * tremolo * 0.70;
  }

  return samples;
}

// 4. Final del partido: Authentic stadium buzzer horn (deep arena resonance)
function generatePartidoFinal() {
  const duration = 0.80;
  const numSamples = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    let env = 1;
    if (t < 0.025) env = t / 0.025;
    else if (t > 0.60) env = Math.max(0, (0.80 - t) / 0.20);

    // Arena horn chords: 220Hz (A3) + 330Hz (E4) with odd harmonics for brassy stadium buzzer
    const f0 = 220;
    const wave =
      0.50 * Math.sin(2 * Math.PI * f0 * t) +
      0.30 * Math.sin(2 * Math.PI * (f0 * 1.5) * t) +
      0.15 * Math.sin(2 * Math.PI * (f0 * 3) * t) +
      0.05 * Math.sin(2 * Math.PI * (f0 * 5) * t);

    samples[i] = wave * env * 0.80;
  }

  return samples;
}

// 5. Aviso recordatorio: Stick Live modern subtle glass ping
function generateAvisoRecordatorio() {
  const duration = 0.40;
  const numSamples = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.min(1, t / 0.008) * Math.exp(-t * 14);

    const f = 987.77; // B5
    const wave =
      0.70 * Math.sin(2 * Math.PI * f * t) +
      0.30 * Math.sin(2 * Math.PI * (f * 2) * t);

    samples[i] = wave * env * 0.75;
  }

  return samples;
}

const soundsDir = path.resolve(__dirname, '../assets/sounds');
if (!fs.existsSync(soundsDir)) {
  fs.mkdirSync(soundsDir, { recursive: true });
}

const files = [
  { name: 'gol_favor.wav', samples: generateGolFavor() },
  { name: 'gol_contra.wav', samples: generateGolContra() },
  { name: 'partido_inicio.wav', samples: generatePartidoInicio() },
  { name: 'partido_final.wav', samples: generatePartidoFinal() },
  { name: 'aviso_recordatorio.wav', samples: generateAvisoRecordatorio() },
];

for (const { name, samples } of files) {
  const filePath = path.join(soundsDir, name);
  const buffer = createWavBuffer(samples);
  fs.writeFileSync(filePath, buffer);
  console.log(`Generated: ${filePath} (${buffer.length} bytes, ${(samples.length / SAMPLE_RATE).toFixed(2)}s)`);
}
