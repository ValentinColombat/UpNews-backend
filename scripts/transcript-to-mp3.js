/**
 * transcript-to-mp3.js
 *
 * Convertit un transcript dialogue brut (format Léa/Alex) en fichier MP3.
 * Utile pour régénérer l'audio d'articles existants sans repasser par Claude.
 *
 * Usage :
 *   node scripts/transcript-to-mp3.js <fichier_transcript.txt> [sortie.mp3]
 *
 * Exemple :
 *   node scripts/transcript-to-mp3.js mon_dialogue.txt output/article_42.mp3
 *
 * Format attendu du fichier transcript (une réplique par ligne) :
 *   Léa: ...
 *   Alex: ...
 *   Léa: ...
 *   ...
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generatePcmWithGeminiTts,
  buildDialogTtsPrompt,
  DEFAULT_SPEAKER_VOICE_CONFIGS,
} from '../src/services/gemini-tts-client.js';
import { pcmToMp3 } from '../src/services/audio-converter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '..', 'temp');

// ─── Arguments ────────────────────────────────────────────────────────────────

const [,, transcriptArg, outputArg] = process.argv;

if (!transcriptArg) {
  console.error('Usage: node scripts/transcript-to-mp3.js <fichier_transcript.txt> [sortie.mp3]');
  process.exit(1);
}

const transcriptPath = path.resolve(transcriptArg);

if (!fs.existsSync(transcriptPath)) {
  console.error(`Fichier introuvable : ${transcriptPath}`);
  process.exit(1);
}

// Nom de sortie : argument fourni, ou même nom que l'entrée avec extension .mp3
const mp3Path = outputArg
  ? path.resolve(outputArg)
  : transcriptPath.replace(/\.[^.]+$/, '') + '.mp3';

// ─── Validation du transcript ─────────────────────────────────────────────────

function validateTranscript(raw) {
  const lines = (raw || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^transcript\s*:/i.test(l));

  if (lines.length < 6 || lines.length > 14) {
    throw new Error(
      `Transcript invalide : ${lines.length} lignes (attendu 6-14).`
    );
  }

  let hasLea = false;
  let hasAlex = false;

  for (const line of lines) {
    if (!line.startsWith('Léa:') && !line.startsWith('Alex:')) {
      throw new Error(
        `Ligne ne commençant pas par "Léa:" ou "Alex:" :\n  ${line}`
      );
    }
    if (line.startsWith('Léa:')) hasLea = true;
    if (line.startsWith('Alex:')) hasAlex = true;
  }

  if (!hasLea || !hasAlex) {
    throw new Error('Léa et Alex doivent tous les deux apparaître dans le transcript.');
  }

  return lines.join('\n');
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nTranscript : ${transcriptPath}`);
  console.log(`Sortie MP3 : ${mp3Path}\n`);

  // 1. Lecture + validation
  const raw = fs.readFileSync(transcriptPath, 'utf8');
  let transcript;
  try {
    transcript = validateTranscript(raw);
  } catch (err) {
    console.error(`Validation échouée : ${err.message}`);
    process.exit(1);
  }

  const lineCount = transcript.split('\n').filter(Boolean).length;
  console.log(`[1/2] Transcript validé — ${lineCount} répliques`);

  // 2. Synthèse vocale Gemini TTS
  console.log('[2/2] Synthèse vocale (Gemini TTS)...');
  const ttsPrompt = buildDialogTtsPrompt(transcript);
  const { pcmBuffer, sampleRateHz, channels } = await generatePcmWithGeminiTts({
    prompt: ttsPrompt,
    speakerVoiceConfigs: DEFAULT_SPEAKER_VOICE_CONFIGS,
  });
  console.log(`      OK — ${(pcmBuffer.length / 1024).toFixed(0)} KB PCM reçus`);

  // 3. Conversion PCM -> MP3
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const pcmPath = path.join(TEMP_DIR, `_transcript_tmp_${Date.now()}.pcm`);

  fs.writeFileSync(pcmPath, pcmBuffer);
  pcmToMp3({ pcmPath, mp3Path, sampleRateHz, channels });
  fs.unlinkSync(pcmPath);

  console.log(`\nMP3 généré : ${mp3Path}`);
}

main().catch((err) => {
  console.error('\nErreur :', err.message);
  process.exit(1);
});
