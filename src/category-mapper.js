import { readFile, appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const VALID_CATEGORIES = ['ecologie', 'santé', 'sciences-et-tech', 'social-et-culture'];

let mappingConfig = null;

// Charger la configuration au démarrage
async function loadMappingConfig() {
  if (!mappingConfig) {
    const configFile = await readFile('./data/category-mapping.json', 'utf-8');
    mappingConfig = JSON.parse(configFile);
  }
  return mappingConfig;
}

// Logger les mismatches entre mots-clés et Claude pour ajuster les mots-clés
export async function logCategoryMismatch(article, keywordCategory, claudeCategory) {
  const logDir = './logs';
  const logFile = join(logDir, 'category-mismatches.log');

  if (!existsSync(logDir)) {
    await mkdir(logDir, { recursive: true });
  }

  const logEntry = {
    timestamp: new Date().toISOString(),
    title: article.title,
    description: article.description?.substring(0, 200),
    source: article.source,
    url: article.url,
    keywordCategory: keywordCategory,
    claudeCategory: claudeCategory
  };

  console.log(`  MISMATCH: mots-clés="${keywordCategory}" vs Claude="${claudeCategory}" pour "${article.title.substring(0, 60)}..."`);
  await appendFile(logFile, JSON.stringify(logEntry) + '\n');
}

// Logger les articles sélectionnés pour tracker la pertinence des sources
export async function logSelectedArticle(article, category) {
  const logDir = './logs';
  const logFile = join(logDir, 'selected-articles.log');

  if (!existsSync(logDir)) {
    await mkdir(logDir, { recursive: true });
  }

  const logEntry = {
    timestamp: new Date().toISOString(),
    source: article.source,
    category: category,
    method: article.categoryMethod,
    confidence: article.categoryConfidence,
    positivityScore: article.positivityScore,
    title: article.title,
    url: article.url
  };

  await appendFile(logFile, JSON.stringify(logEntry) + '\n');
}

// Chercher des mots-clés dans le titre et la description
function matchKeywords(article) {
  const config = mappingConfig;
  const text = `${article.title} ${article.description}`.toLowerCase();

  const scores = {};

  for (const [category, keywords] of Object.entries(config.keyword_patterns)) {
    scores[category] = 0;

    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        scores[category]++;
      }
    }
  }

  // Minimum 2 mots-clés requis
  const sortedCategories = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .filter(([_, score]) => score >= 2);

  if (sortedCategories.length === 0) {
    return null;
  }

  const [bestCategory, bestScore] = sortedCategories[0];
  const confidence = bestScore >= 3 ? 'high' : 'medium';

  return {
    category: bestCategory,
    method: 'keyword_match',
    confidence: confidence,
    matchCount: bestScore
  };
}

// Nettoyer la réponse Claude (supprime les backticks markdown si présents)
function cleanJsonResponse(text) {
  return text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
}

// Catégoriser un article avec Claude Haiku (fallback quand les mots-clés échouent)
async function categorizeWithClaude(article) {
  const prompt = `Tu es un expert en catégorisation d'articles d'actualité positive.

Catégorise cet article dans UNE SEULE des catégories suivantes :
- ecologie (environnement, climat, biodiversité, énergie renouvelable)
- santé (médecine, bien-être, recherche médicale, santé publique)
- sciences-et-tech (technologie, innovation, IA, espace, découvertes scientifiques)
- social-et-culture (société, éducation, art, musique, solidarité, justice sociale)

Article :
Titre: ${article.title}
Description: ${article.description || 'Aucune description'}

RÉPONDS UNIQUEMENT en JSON valide (pas de markdown) :
{"category": "...", "raison": "..."}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }]
    });

    const response = JSON.parse(cleanJsonResponse(message.content[0].text));

    if (!VALID_CATEGORIES.includes(response.category)) {
      console.warn(`  Claude a retourné une catégorie invalide: "${response.category}", fallback uncategorized`);
      return { category: 'uncategorized', method: 'claude_categorization', confidence: 'low' };
    }

    console.log(`  Claude categorization: "${response.category}" (${response.raison})`);
    return {
      category: response.category,
      method: 'claude_categorization',
      confidence: 'high'
    };
  } catch (error) {
    console.error(`  Erreur Claude categorization: ${error.message}`);
    return { category: 'uncategorized', method: 'claude_categorization_error', confidence: 'low' };
  }
}

// Vérifier avec Claude que la catégorie trouvée par mots-clés est correcte
export async function verifyCategoryWithClaude(article, keywordCategory) {
  const prompt = `Tu es un expert en catégorisation d'articles d'actualité.

Un système de mots-clés a classé cet article dans la catégorie "${keywordCategory}".

Les catégories possibles sont :
- ecologie (environnement, climat, biodiversité, énergie renouvelable)
- santé (médecine, bien-être, recherche médicale, santé publique)
- sciences-et-tech (technologie, innovation, IA, espace, découvertes scientifiques)
- social-et-culture (société, éducation, art, musique, solidarité, justice sociale)

Article :
Titre: ${article.title}
Description: ${article.description || 'Aucune description'}

La catégorie "${keywordCategory}" est-elle correcte pour cet article ?

RÉPONDS UNIQUEMENT en JSON valide (pas de markdown) :
{"confirmed": true/false, "suggestedCategory": "la bonne catégorie", "raison": "explication courte"}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }]
    });

    const response = JSON.parse(cleanJsonResponse(message.content[0].text));

    console.log(`  Vérification Claude: ${response.confirmed ? 'CONFIRMÉ' : 'REJETÉ'} (${response.raison})`);
    return {
      confirmed: response.confirmed,
      suggestedCategory: response.suggestedCategory || keywordCategory,
      raison: response.raison
    };
  } catch (error) {
    console.error(`  Erreur vérification Claude: ${error.message}`);
    // En cas d'erreur, on fait confiance aux mots-clés
    return { confirmed: true, suggestedCategory: keywordCategory, raison: 'Erreur API - confiance mots-clés par défaut' };
  }
}

// Fonction principale de catégorisation
export async function categorizeArticle(article) {
  await loadMappingConfig();

  // 1. Essayer les mots-clés (analyse du contenu)
  let result = matchKeywords(article);

  // 2. Si pas de match, catégoriser avec Claude Haiku
  if (!result) {
    result = await categorizeWithClaude(article);
  }

  return {
    category: result.category,
    confidence: result.confidence,
    method: result.method
  };
}

// Grouper les articles par catégorie
export function groupArticlesByCategory(articles) {
  const grouped = {
    ecologie: [],
    santé: [],
    'sciences-et-tech': [],
    'social-et-culture': [],
    uncategorized: []
  };

  for (const article of articles) {
    if (article.appCategory && grouped[article.appCategory]) {
      grouped[article.appCategory].push(article);
    }
  }

  return grouped;
}
