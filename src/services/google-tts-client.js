import textToSpeech from '@google-cloud/text-to-speech';
import fs from 'fs';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);

class GoogleTTSClient {
  constructor() {
    this.client = new textToSpeech.TextToSpeechClient();
  }

  /**
   * Génère un fichier audio avec Google Cloud TTS
   * @param {string} text - Texte à convertir en audio
   * @param {object} options - Options de génération
   * @returns {Promise<Buffer>} - Buffer audio MP3
   */
  
    async synthesizeSpeech(text, options = {}) {
      const {
        voiceName = 'fr-FR-Chirp3-HD-Leda', // ← Voix féminine Chirp 3 HD
        languageCode = 'fr-FR',
        speakingRate = 1.0,
        pitch = 0.0,
      } = options;
  
    const request = {
      input: { text },
      voice: {
        languageCode,
        name: voiceName,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate,
        pitch,
      },
    };

    try {
      console.log(`Génération audio avec ${voiceName}...`);
      const [response] = await this.client.synthesizeSpeech(request);
      
      if (!response.audioContent) {
        throw new Error('Aucun contenu audio généré');
      }

      console.log(` Audio généré (${text.length} caractères)`);
      return response.audioContent;
    } catch (error) {
      console.error(' Erreur Google TTS:', error.message);
      throw error;
    }
  }

  /**
   * Génère un audio multi-speaker (pour format podcast)
   * @param {Array} segments - [{speaker: 'A', text: '...'}, ...]
   * @returns {Promise<Buffer>} - Buffer audio combiné
   */
  async synthesizeMultiSpeaker(segments) {
  const audioBuffers = [];

  for (const segment of segments) {
    const voiceName = segment.speaker === 'A' 
      ? 'fr-FR-Chirp3-HD-Charon'  // ← Voix masculine
      : 'fr-FR-Chirp3-HD-Leda';   // ← Voix féminine

    const audioBuffer = await this.synthesizeSpeech(segment.text, {
      voiceName,
    });

    audioBuffers.push(audioBuffer);
  }

  return Buffer.concat(audioBuffers);
}

  /**
   * Sauvegarde un buffer audio dans un fichier
   * @param {Buffer} audioBuffer - Buffer audio
   * @param {string} filepath - Chemin du fichier
   */
  async saveToFile(audioBuffer, filepath) {
    await writeFile(filepath, audioBuffer, 'binary');
    console.log(` Audio sauvegardé: ${filepath}`);
  }

  /**
   * Calcule le coût estimé pour un texte donné
   * @param {number} characterCount - Nombre de caractères
   * @returns {number} - Coût en USD
   */
  calculateCost(characterCount) {
    // Chirp 3 HD: 60$ par million de caractères
    const costPerMillion = 60;
    return (characterCount / 1000000) * costPerMillion;
  }
}

export const googleTTSClient = new GoogleTTSClient();