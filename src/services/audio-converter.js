// Convertit un fichier PCM brut en MP3 via ffmpeg.
// Prerequis : ffmpeg doit etre installe sur le systeme (disponible dans le PATH).
// En production (GitHub Actions), il est installe via : apt-get install -y ffmpeg


import { execFileSync } from 'node:child_process';

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
    { stdio: 'inherit' } // Affiche les logs ffmpeg dans la console 
  );
}
