/*Ce fichier est le SEUL point d'entree pour la generation audio.
  Il coordonne les trois etapes du pipeline dans l'ordre :
   
  ETAPE 1 — Script dialogue  (dialog-script-generator.js)
  Claude transforme l'article en dialogue Lea/Alex (texte pur, format strict)
   
  ETAPE 2 — Synthese vocale  (gemini-tts-client.js)
  Gemini TTS synthetise le dialogue en PCM brut via 1 seul appel API.

  ETAPE 3 — Conversion audio  (audio-converter.js)
  ffmpeg convertit le PCM brut en MP3 compresse (128kbps), lisible partout.
 */

import fs from 'node:fs';
import path from 'node:path';

import { generateDialogScriptFromArticle } from './dialog-script-generator.js';
import {
  generatePcmWithGeminiTts,
  buildDialogTtsPrompt,
  DEFAULT_SPEAKER_VOICE_CONFIGS,
} from './gemini-tts-client.js';
import { pcmToMp3 } from './audio-converter.js';

// Dossier temporaire pour les fichiers PCM intermediaires et les MP3 finaux.
// - Les fichiers .pcm sont supprimes apres conversion (inutiles apres ffmpeg).
// - Les fichiers .mp3 sont conserves jusqu'a leur upload vers Supabase (dans index.js).
const TEMP_DIR = './temp';

// Génère le fichier audio MP3 d'un article sous forme de podcast dialogue.

export async function generateAudioForArticle(article) {
  // Créer le dossier temporaire s'il n'existe pas encore
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  // Claude recoit le contenu de l'article et produit un transcript structure :
  //   Lea: [replique]
  //   Alex: [replique]
  //   ...
  // Le transcript est valide (8-14 repliques, format strict) avant d'etre retourne.
  // La validation est faite dans dialog-script-generator.js.

  console.log('\n   [1/3] Generation du script dialogue (Claude)...');

  const transcript = await generateDialogScriptFromArticle(article);
  const lineCount = transcript.split('\n').filter(Boolean).length;
  console.log(`         OK — ${lineCount} repliques generees`);

  // Enveloppe le transcript dans un "Audio Profile" qui
  // donne a Gemini TTS des instructions sur le style, le ton et les personnages.

  // Un seul appel API suffit pour tout le dialogue : Gemini identifie les speakers
  // via leur nom dans le transcript ("Lea:", "Alex:") et applique automatiquement
  // la voix correspondante (configuree dans DEFAULT_SPEAKER_VOICE_CONFIGS).
  //
  // La reponse est du PCM brut : pas de header, pas de compression — juste
  // des echantillons audio 16-bit a 24000 Hz en mono.
  console.log('\n   [2/3] Synthese vocale multi-speaker (Gemini TTS)...');

  const ttsPrompt = buildDialogTtsPrompt(transcript);

  const { pcmBuffer, sampleRateHz, channels } = await generatePcmWithGeminiTts({
    prompt: ttsPrompt,
    speakerVoiceConfigs: DEFAULT_SPEAKER_VOICE_CONFIGS,
  });

  console.log(`         OK — ${(pcmBuffer.length / 1024).toFixed(0)} KB PCM recus`);


  // On ecrit donc le PCM sur disque, on convertit, puis on supprime le PCM.
  // Seul le MP3 final est conserve pour l'upload Supabase.
  console.log('\n   [3/3] Conversion PCM -> MP3 (ffmpeg)...');

  const pcmPath = path.join(TEMP_DIR, `article_${article.id}.pcm`);
  const mp3Path = path.join(TEMP_DIR, `article_${article.id}_podcast.mp3`);

  // Ecriture du PCM brut (etape intermediaire requise par ffmpeg)
  fs.writeFileSync(pcmPath, pcmBuffer);

  // Conversion vers MP3 128kbps avec les parametres Gemini TTS (24000 Hz, mono)
  pcmToMp3({ pcmPath, mp3Path, sampleRateHz, channels });

  // Suppression du PCM intermediaire — on n'en a plus besoin
  fs.unlinkSync(pcmPath);

  console.log(`         OK — MP3 pret: ${mp3Path}`);

  return {
    filepath: mp3Path,
    format: 'podcast', 
  };
}
