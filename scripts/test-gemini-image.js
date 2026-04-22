/**
 * Test isolé : génération d'image avec Gemini 2.5 Flash
 *
 * Usage : node scripts/test-gemini-image.js
 *
 * Prérequis :
 *   - GOOGLE_APPLICATION_CREDENTIALS dans .env (chemin vers le JSON de service account)
 *   - GOOGLE_CLOUD_PROJECT_ID dans .env
 *
 * Résultat : ./temp/test-gemini-image.png
 */

import 'dotenv/config';
import fs from 'fs';
import { geminiImageClient } from '../src/services/gemini-image-client.js';

const TEST_PROMPT = 'A community garden with people planting vegetables together';

async function main() {
  console.log('--- Test génération image Gemini 2.5 Flash ---');
  console.log(`Prompt de test : "${TEST_PROMPT}"`);
  console.log(`Projet GCP     : ${process.env.GOOGLE_CLOUD_PROJECT_ID}`);
  console.log('');

  const start = Date.now();

  const imageBuffer = await geminiImageClient.generateImage(TEST_PROMPT);

  const tempDir = './temp';
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const outputPath = `${tempDir}/test-gemini-image.png`;
  await geminiImageClient.saveToFile(imageBuffer, outputPath);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const cost = geminiImageClient.calculateCost(1);

  console.log('');
  console.log('--- Résultat ---');
  console.log(`Fichier  : ${outputPath}`);
  console.log(`Taille   : ${(imageBuffer.length / 1024).toFixed(0)} KB`);
  console.log(`Durée    : ${elapsed}s`);
  console.log(`Coût est.: $${cost.toFixed(4)}`);
}

main().catch(err => {
  console.error('Erreur :', err.message);
  process.exit(1);
});
