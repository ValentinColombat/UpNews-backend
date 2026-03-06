/**
 * gemini-tts-client.js
 *
 * Client Gemini TTS (Text-to-Speech multi-speaker).
 *
 * Responsabilite unique : prendre un prompt texte + des configs de voix,
 * et retourner un buffer PCM brut (audio non compresse).
 *
 * Le PCM est ensuite converti en MP3 par audio-converter.js via ffmpeg.
 * Ce decoupage permet de tester chaque etape independamment.
 *
 * Avantage cle vs l'ancien Google TTS :
 *   - Google TTS : N appels API (un par replique du dialogue)
 *   - Gemini TTS : 1 seul appel pour tout le dialogue, multi-speaker natif
 */

import { GoogleGenAI } from '@google/genai';

// Initialisation du client Gemini avec la cle API depuis l'environnement.
// Singleton : instancie une seule fois au chargement du module.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ---------------------------------------------------------------------------
// Voix et configuration des speakers UpNews
// ---------------------------------------------------------------------------
// Ces voix ont ete choisies parmi les voix "prebuilt" Gemini TTS pour leur
// naturel en francais et leur adequation avec les personnages du podcast.
export const UPNEWS_VOICES = {
  LEA: 'Aoede',        // Voix feminine, chaleureuse — animatrice principale
  ALEX: 'Sadaltager',  // Voix masculine, posee — expert contextuel
};

// Configuration par defaut des speakers :
// Lie le nom du speaker (tel qu'il apparait dans le transcript "Lea: ...")
// a la voix Gemini correspondante. Ce tableau est passe directement a l'API.
export const DEFAULT_SPEAKER_VOICE_CONFIGS = [
  { speaker: 'Léa', voiceName: UPNEWS_VOICES.LEA },
  { speaker: 'Alex', voiceName: UPNEWS_VOICES.ALEX },
];

// ---------------------------------------------------------------------------
// buildDialogTtsPrompt
// ---------------------------------------------------------------------------

/**
 * Formate un transcript dialogue brut en prompt complet pour Gemini TTS.
 *
 * Gemini TTS supporte les "Director's Notes" : des instructions de style
 * qui guident le modele sur le ton, l'accent et le rythme. Sans ce wrapper,
 * la synthese est correcte mais moins naturelle et expressive.
 *
 * @param {string} dialogTranscript - Transcript au format "Lea: ...\nAlex: ..."
 * @returns {string} Prompt complet pret a envoyer a l'API
 */
export function buildDialogTtsPrompt(dialogTranscript) {
  return `
# AUDIO PROFILE: Format Dialogue UpNews

## HOST 1 — Léa (Animatrice principale)
Journaliste radio enthousiaste et accessible. Sourire vocal, energie positive.

## HOST 2 — Alex (Expert contextuel)
Expert pose et bienveillant. Apporte du contexte sans alourdir.

### DIRECTOR'S NOTES
Style: Podcast informatif moderne, naturel, pas robotique.
Accent: Francais de France, neutre.
Transitions: petites pauses naturelles entre repliques.

### TRANSCRIPT
${dialogTranscript}
`.trim();
}

// ---------------------------------------------------------------------------
// Utilitaires internes
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Execute une fonction async avec retry et backoff exponentiel + jitter.
 *
 * Pourquoi ? L'API Gemini peut retourner des erreurs 429 (rate limit) ou
 * des erreurs transitoires 5xx. Le backoff exponentiel + jitter evite de
 * surcharger l'API si plusieurs articles sont traites en parallele.
 *
 * Exemple de delais : 1s, 2s, 4s, 8s, 16s (+ jitter aleatoire <= 250ms)
 *
 * @param {Function} fn - Fonction async a executer
 * @param {object} opts
 * @param {number} opts.retries    - Nombre max de tentatives (defaut: 5)
 * @param {number} opts.baseDelayMs - Delai de base en ms (defaut: 1000)
 */
async function withRetry(fn, { retries = 5, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      const jitter = Math.floor(Math.random() * 250);
      const wait = baseDelayMs * Math.pow(2, attempt - 1) + jitter;

      console.error(`[GeminiTTS] Tentative ${attempt}/${retries} echouee: ${e.message}`);
      if (attempt < retries) {
        console.error(`   Nouvel essai dans ${wait}ms...`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

/**
 * Extrait le contenu audio base64 de la reponse Gemini.
 *
 * La reponse est structuree ainsi :
 *   response.candidates[0].content.parts[N].inlineData.data  <- base64 audio
 *
 * On cherche la premiere "part" qui contient un inlineData.data non vide.
 *
 * @param {object} response - Reponse brute de l'API Gemini
 * @returns {string|null} Chaine base64 de l'audio, ou null si absente
 */
function extractAudioBase64(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;

  for (const part of parts) {
    const data = part?.inlineData?.data;
    if (typeof data === 'string' && data.length > 0) return data;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fonction principale exportee
// ---------------------------------------------------------------------------

/**
 * Synthetise un dialogue multi-speaker avec Gemini TTS.
 *
 * IMPORTANT : La sortie est du PCM brut (s16le, mono, 24000 Hz).
 * Ce n'est PAS un MP3 lisible directement.
 * La conversion PCM -> MP3 est effectuee par audio-converter.js (ffmpeg).
 *
 * @param {object} params
 * @param {string} params.prompt              - Prompt complet (voir buildDialogTtsPrompt)
 * @param {Array}  params.speakerVoiceConfigs  - [{speaker, voiceName}, ...]
 * @param {string} [params.model]             - Modele Gemini TTS a utiliser
 *
 * @returns {Promise<{pcmBuffer: Buffer, sampleRateHz: number, channels: number}>}
 */
export async function generatePcmWithGeminiTts({
  prompt,
  speakerVoiceConfigs = DEFAULT_SPEAKER_VOICE_CONFIGS,
  model = 'gemini-2.5-flash-preview-tts',
}) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY manquant (env).');
  if (!prompt?.trim()) throw new Error('Prompt TTS vide.');
  if (!Array.isArray(speakerVoiceConfigs) || speakerVoiceConfigs.length === 0) {
    throw new Error('speakerVoiceConfigs manquant ou vide.');
  }

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        // On demande explicitement une reponse AUDIO (pas texte par defaut)
        responseModalities: ['AUDIO'],
        speechConfig: {
          // Mode multi-speaker : chaque speaker du transcript recoit sa propre voix.
          // Gemini identifie les speakers via leur nom dans le transcript ("Lea: ...").
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: speakerVoiceConfigs.map(({ speaker, voiceName }) => ({
              speaker,
              voiceConfig: { prebuiltVoiceConfig: { voiceName } },
            })),
          },
        },
      },
    });

    const audioBase64 = extractAudioBase64(response);

    if (!audioBase64) {
      // Si l'audio est absent, on log la structure brute pour diagnostiquer.
      // Cela peut arriver si Gemini juge le contenu inapproprie ou si la reponse
      // est malformee (changement d'API, quota depassé, etc.).
      const parts = response?.candidates?.[0]?.content?.parts;
      const debug = JSON.stringify(
        parts?.map((p) => ({
          keys: Object.keys(p || {}),
          mimeType: p?.inlineData?.mimeType,
          hasData: !!p?.inlineData?.data,
        })),
        null,
        2
      );
      throw new Error(`Reponse Gemini TTS sans audio. Structure parts:\n${debug}`);
    }

    // Decode le base64 en Buffer Node.js — c'est le PCM brut
    return {
      pcmBuffer: Buffer.from(audioBase64, 'base64'),
      sampleRateHz: 24000, // Gemini TTS produit toujours du 24 kHz
      channels: 1,         // Mono
    };
  });
}
