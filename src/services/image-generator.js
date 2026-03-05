import Anthropic from '@anthropic-ai/sdk';
import { googleImagenClient } from './google-imagen-client.js';
import fs from 'fs';
import path from 'path';
import { MODELS } from '../config/models.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Génère un prompt visuel avec Claude basé sur l'article
 * @param {object} article - Article avec content et category
 * @returns {Promise<string>} - Prompt visuel pour Imagen
 */
async function generateImagePrompt(article) {
  const prompt = `Tu es un expert en direction artistique pour une application d'actualités positives.

MISSION : Créer un prompt visuel court (1 phrase, max 15 mots) pour illustrer cet article.

ARTICLE :
${article.content.substring(0, 1500)}

CATÉGORIE : ${article.appCategory || 'Actualités'}

CONTRAINTES :
- Décris une SCÈNE VISUELLE concrète (pas de concepts abstraits)
- Inclus des PERSONNES ou des ÉLÉMENTS VIVANTS si pertinent
- Ton POSITIF et OPTIMISTE
- EN ANGLAIS (pour le modèle de génération)
- PAS de texte, logos, ou marques dans la description
- Évite les visages en gros plan

EXEMPLES DE BONS PROMPTS :
- "A community garden with people planting vegetables together"
- "Solar panels on rooftops of a colorful neighborhood"
- "Children playing in a newly opened public park"
- "Scientists celebrating a discovery in a modern laboratory"

RÉPONDS UNIQUEMENT AVEC LE PROMPT, RIEN D'AUTRE.`;

  try {
    const message = await anthropic.messages.create({
      model: MODELS.imagePrompt,
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });

    const imagePrompt = message.content[0].text.trim();
    console.log(`Prompt visuel généré: ${imagePrompt}`);

    return imagePrompt;
  } catch (error) {
    console.error('Erreur génération prompt visuel:', error.message);
    throw error;
  }
}

/**
 * Génère une image pour un article
 * @param {object} article - Article avec id, content, category
 * @returns {Promise<{filepath: string, cost: number, prompt: string}>}
 */
export async function generateImageForArticle(article) {
  console.log(`\nGénération image pour article ${article.id}`);

  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 1. Générer le prompt visuel avec Claude
      const imagePrompt = await generateImagePrompt(article);

      // 2. Générer l'image avec Imagen
      const imageBuffer = await googleImagenClient.generateImage(imagePrompt);

      // 3. Sauvegarder temporairement le fichier
      const tempDir = './temp';
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const filename = `article_${article.id}_image.png`;
      const filepath = path.join(tempDir, filename);

      await googleImagenClient.saveToFile(imageBuffer, filepath);

      // 4. Calculer le coût
      const cost = googleImagenClient.calculateCost(1);
      console.log(`Coût image: $${cost.toFixed(4)}`);

      return {
        filepath,
        cost,
        prompt: imagePrompt,
      };
    } catch (error) {
      console.error(`Tentative ${attempt}/${maxRetries} échouée pour article ${article.id}: ${error.message}`);

      if (attempt < maxRetries) {
        const delay = 30000 + (attempt * 15000); // 30s, 45s, 60s
        console.log(`⏳ Nouvelle tentative dans ${delay / 1000}s (quota rate limit)...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`Échec définitif après ${maxRetries} tentatives pour article ${article.id}`);
        throw error;
      }
    }
  }
}
