import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

import { generatePcmWithGeminiTts } from '../src/services/gemini-tts-client.js';
import { pcmToMp3 } from '../src/services/audio-converter.js';

function buildDialogTtsPrompt(dialogTranscript) {
  return `
# AUDIO PROFILE: Format Dialogue UpNews

## HOST 1 — Léa (Animatrice principale)
Journaliste radio enthousiaste et accessible. Sourire vocal, énergie positive.

## HOST 2 — Alex (Expert contextuel)
Expert posé et bienveillant. Apporte du contexte sans alourdir.

### DIRECTOR'S NOTES
Style: Podcast informatif moderne, naturel, pas robotique.
Accent: Français de France, neutre.
Transitions: petites pauses naturelles entre répliques.

### TRANSCRIPT
${dialogTranscript}
`.trim();
}

async function main() {
  const dialogTranscript = `Léa: Excellente nouvelle dans la lutte contre les déchets plastiques ! Des chercheurs viennent de développer une méthode révolutionnaire de recyclage qui consomme beaucoup moins d'énergie que les techniques actuelles.
Alex: Cette innovation est particulièrement intéressante car elle permet de traiter des plastiques complexes, souvent impossibles à recycler avec les méthodes traditionnelles. Cela représente un véritable bond technologique.
Léa: Et les résultats des tests sont impressionnants ! On parle d'une réduction importante des déchets, mais aussi d'une amélioration significative des coûts de traitement.
Alex: Exactement, et cela change tout pour les collectivités locales. Jusqu'à présent, le coût élevé du recyclage était souvent un frein majeur à son développement à grande échelle.
Léa: Justement, plusieurs villes montrent déjà leur intérêt ! Elles envisagent de lancer des projets pilotes dès 2026 pour tester cette technologie.
Alex: Cela montre que nous entrons dans une phase concrète de déploiement. Si ces pilotes confirment les résultats de laboratoire, nous pourrions voir une adoption plus large dans les années suivantes.
Léa: Imaginez l'impact positif : moins de plastiques dans nos décharges et nos océans, une économie circulaire renforcée, et des emplois verts créés localement.
Alex: Et surtout, cela pourrait transformer notre rapport aux déchets plastiques, en les considérant non plus comme un problème mais comme une ressource valorisable.
Léa: Une belle démonstration que l'innovation peut réconcilier écologie et économie ! Le futur du recyclage semble plus prometteur que jamais.`; // colle ici ton transcript validé

  const prompt = buildDialogTtsPrompt(dialogTranscript);

  const { pcmBuffer, sampleRateHz, channels } = await generatePcmWithGeminiTts({
    prompt,
    speakerVoiceConfigs: [
      { speaker: 'Léa', voiceName: 'Aoede' },
      { speaker: 'Alex', voiceName: 'Sadaltager' },
    ],
  });

  const outDir = './temp';
  fs.mkdirSync(outDir, { recursive: true });

  const pcmPath = path.join(outDir, 'test_dialog.pcm');
  const mp3Path = path.join(outDir, 'test_dialog.mp3');

  fs.writeFileSync(pcmPath, pcmBuffer);
  pcmToMp3({ pcmPath, mp3Path, sampleRateHz, channels });

  console.log(`✅ MP3 généré: ${mp3Path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});