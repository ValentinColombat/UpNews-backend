/**
 * audio-converter.js
 *
 * Convertit un fichier PCM brut en MP3 via ffmpeg.
 *
 * Pourquoi passer par ffmpeg ?
 * Gemini TTS retourne de l'audio au format PCM (Pulse Code Modulation) :
 * des echantillons audio bruts, non comprimes, non encapsules.
 * Ce format n'est pas lisible par un navigateur ou un lecteur audio standard.
 * ffmpeg prend ce PCM en entree et produit un MP3 standard, petit et compatible.
 *
 * Prerequis : ffmpeg doit etre installe sur le systeme (disponible dans le PATH).
 * En production (GitHub Actions), il est installe via : apt-get install -y ffmpeg
 */

import { execFileSync } from 'node:child_process';

/**
 * Convertit un fichier PCM s16le (mono) en MP3.
 *
 * Les parametres par defaut correspondent exactement au format produit
 * par Gemini TTS : PCM 16-bit signe little-endian, 24000 Hz, mono.
 *
 * @param {object} params
 * @param {string} params.pcmPath      - Chemin du fichier PCM source (entree)
 * @param {string} params.mp3Path      - Chemin du fichier MP3 destination (sortie)
 * @param {number} [params.sampleRateHz=24000] - Frequence d'echantillonnage en Hz
 * @param {number} [params.channels=1]          - Nombre de canaux (1=mono, 2=stereo)
 * @param {string} [params.bitrate='128k']      - Bitrate MP3 cible
 * @throws {Error} Si ffmpeg n'est pas installe ou si la conversion echoue
 */
export function pcmToMp3({
  pcmPath,
  mp3Path,
  sampleRateHz = 24000,
  channels = 1,
  bitrate = '128k',
}) {
  execFileSync(
    'ffmpeg',
    [
      '-y',                      // Ecraser le fichier de sortie s'il existe deja
      '-f',      's16le',        // Format d'entree : PCM signed 16-bit little-endian
      '-ar',     String(sampleRateHz), // Sample rate (ex: 24000 Hz)
      '-ac',     String(channels),     // Nombre de canaux audio
      '-i',      pcmPath,        // Fichier d'entree (le PCM brut)
      '-codec:a', 'libmp3lame',  // Encodeur MP3
      '-b:a',    bitrate,        // Bitrate cible (128k = bon compromis taille/qualite)
      mp3Path,                   // Fichier de sortie (le MP3 final)
    ],
    { stdio: 'inherit' } // Affiche les logs ffmpeg dans la console (pratique pour debug)
  );
}
