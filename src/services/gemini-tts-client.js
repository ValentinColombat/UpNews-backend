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


// Voix et configuration des speakers UpNews

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

// Formate un transcript dialogue brut en prompt complet pour Gemini TTS.

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


// Utilitaires 


function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Execute une fonction async avec retry et backoff exponentiel + jitter.
 
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

// Extrait le contenu audio base64 de la reponse Gemini.

function extractAudioBase64(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;

  for (const part of parts) {
    const data = part?.inlineData?.data;
    if (typeof data === 'string' && data.length > 0) return data;
  }
  return null;
}


// Fonction principale 

// Synthetise un dialogue multi-speaker avec Gemini TTS.

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
