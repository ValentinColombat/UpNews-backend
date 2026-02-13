import Anthropic from '@anthropic-ai/sdk';
import { googleTTSClient } from './google-tts-client.js';
import fs from 'fs';
import path from 'path';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Nettoyer le texte pour une meilleure prononciation TTS
function sanitizeTextForTTS(text) {
  return text
    // Normaliser toutes les variantes d'apostrophes vers l'apostrophe droite
    .replace(/[\u2019\u2018\u02BC\u0060\u00B4]/g, "'")
    // Normaliser les guillemets typographiques
    .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    // Supprimer les tirets longs isolés (pauses artificielles)
    .replace(/\s[—–]\s/g, ', ')
    // Supprimer le markdown résiduel
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[*_#]/g, '')
    // Nettoyer les espaces multiples
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Génère un script de podcast conversationnel avec Claude
 * @param {object} article - Article généré
 * @returns {Promise<Array>} - [{speaker: 'A', text: '...'}, ...]
 */
async function generatePodcastScript(article) {
  const prompt = `Tu es un expert en création de podcasts conversationnels pour une app d'actualités positives.

MISSION : Transformer cet article en script de podcast conversationnel de 2 minutes.

ARTICLE :
${article.content}

CONTRAINTES :
- Durée : ~1500 caractères de dialogue (= 2 minutes audio)
- 2 animateurs : Alex (curieux, pose questions) et Sarah (experte, enthousiaste)
- Ton : Optimiste, accessible, conversationnel
- Structure : Intro accrocheuse → Discussion → Takeaway positif

RÈGLE AUDIO CRITIQUE (ce script sera lu par un TTS) :
- INTERDICTION ABSOLUE d'utiliser des apostrophes d'élision : pas de l', d', n', s', t', j', m', c', qu'
- Reformule TOUJOURS pour éviter toute élision. Exemples :
  "c'est génial" → "oh, voilà qui est génial"
  "l'idée" → "cette idée"
  "d'ailleurs" → "par ailleurs"
  "qu'on" → "que nous" ou "que les gens"
  "n'est-ce pas" → "tu ne penses pas ?"
- Chaque réplique doit pouvoir être lue à voix haute sans aucune apostrophe

STYLE À ADOPTER :
 "Oh wow, voilà qui est génial !" (réactions spontanées)
 "Attends, tu veux dire que..." (clarifications naturelles)
 "Exactement ! Par ailleurs..." (transitions fluides)
 Interruptions légères, questions rebond
 Pas de "Bonjour chers auditeurs" (trop formel)
 Pas de conclusion artificielle type "voilà pour cette fois"
 Pas de répétition des infos

FORMAT DE SORTIE STRICT :
[ALEX] Premier dialogue
[SARAH] Réponse
[ALEX] Rebond
[SARAH] Suite
etc.

Important : La conversation doit sembler spontanée, pas scripté. Commence directement par le dialogue.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const scriptText = message.content[0].text;

    // Parser le script
    const segments = parseScript(scriptText);
    
    console.log(`📝 Script podcast généré: ${segments.length} répliques`);
    return segments;
  } catch (error) {
    console.error('❌ Erreur génération script podcast:', error.message);
    throw error;
  }
}

/**
 * Parse un script au format [SPEAKER] text
 * @param {string} script - Script brut
 * @returns {Array} - [{speaker: 'A'|'B', text: '...'}, ...]
 */
function parseScript(script) {
  const lines = script.split('\n').filter(line => line.trim());
  const segments = [];

  for (const line of lines) {
    const match = line.match(/\[(ALEX|SARAH)\]\s*(.+)/i);
    if (match) {
      const speaker = match[1].toUpperCase() === 'ALEX' ? 'A' : 'B';
      const text = match[2].trim();
      if (text) {
        segments.push({ speaker, text });
      }
    }
  }

  return segments;
}

/**
 * Génère un audio au format simple (lecture directe)
 * @param {object} article - Article à lire
 * @returns {Promise<{audioBuffer: Buffer, characterCount: number}>}
 */
export async function generateSimpleAudio(article) {
  try {
    console.log('\n🎙️ Génération audio SIMPLE');
    
    // Nettoyer le texte pour le TTS
    let textToRead = sanitizeTextForTTS(article.content);

    const characterCount = textToRead.length;
    console.log(`Caractères à générer: ${characterCount}`);

    // Choisir aléatoirement une voix
    const voices = ['fr-FR-Chirp3-HD-Charon', 'fr-FR-Chirp3-HD-Leda'];
    const randomVoice = voices[Math.floor(Math.random() * voices.length)];

    const audioBuffer = await googleTTSClient.synthesizeSpeech(textToRead, {
      voiceName: randomVoice,
      speakingRate: 1.0,
    });

    const cost = googleTTSClient.calculateCost(characterCount);
    console.log(` Coût estimé: $${cost.toFixed(4)}`);

    return { audioBuffer, characterCount, cost };
  } catch (error) {
    console.error(' Erreur génération audio simple:', error.message);
    throw error;
  }
}

/**
 * Génère un audio au format podcast (conversation)
 * @param {object} article - Article à transformer
 * @returns {Promise<{audioBuffer: Buffer, characterCount: number}>}
 */
export async function generatePodcastAudio(article) {
  try {
    console.log('\n🎙️ Génération audio PODCAST');

    // 1. Générer le script conversationnel avec Claude
    const segments = await generatePodcastScript(article);

    if (segments.length === 0) {
      throw new Error('Script podcast vide');
    }

    // 2. Nettoyer le texte de chaque segment pour le TTS
    const cleanedSegments = segments.map(seg => ({
      ...seg,
      text: sanitizeTextForTTS(seg.text),
    }));

    // 3. Calculer le nombre total de caractères
    const characterCount = cleanedSegments.reduce((sum, seg) => sum + seg.text.length, 0);
    console.log(`Caractères à générer: ${characterCount}`);

    // 4. Générer l'audio multi-speaker
    const audioBuffer = await googleTTSClient.synthesizeMultiSpeaker(cleanedSegments);

    const cost = googleTTSClient.calculateCost(characterCount);
    console.log(` Coût estimé: $${cost.toFixed(4)}`);

    return { audioBuffer, characterCount, cost };
  } catch (error) {
    console.error(' Erreur génération audio podcast:', error.message);
    throw error;
  }
}

/**
 * Génère l'audio pour un article (choix aléatoire entre simple et podcast)
 * @param {object} article - Article avec id, content, etc.
 * @returns {Promise<{filepath: string, format: string, cost: number}>}
 */
export async function generateAudioForArticle(article) {
  // Choisir aléatoirement le format
  const formats = ['simple', 'podcast'];
  const format = formats[Math.floor(Math.random() * formats.length)];

  console.log(`\n🎲 Format choisi: ${format.toUpperCase()}`);

  let result;
  if (format === 'simple') {
    result = await generateSimpleAudio(article);
  } else {
    result = await generatePodcastAudio(article);
  }

  // Sauvegarder temporairement le fichier
  const tempDir = './temp';
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const filename = `article_${article.id}_${format}.mp3`;
  const filepath = path.join(tempDir, filename);

  await googleTTSClient.saveToFile(result.audioBuffer, filepath);

  return {
    filepath,
    format,
    cost: result.cost,
    characterCount: result.characterCount,
  };
}