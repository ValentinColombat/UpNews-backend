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

  console.log(`  [Mismatch] "${article.title.substring(0, 50)}..." mots-clés="${keywordCategory}" vs Claude="${claudeCategory}"`);
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

  console.log(`  [Mots-clés] "${article.title.substring(0, 50)}..." -> ${bestCategory} (${bestScore} mots-clés)`);
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

// Catégoriser plusieurs articles en BATCH avec Claude Haiku (1 seule requête)
// Si trop d'articles, divise en plusieurs batches de MAX_BATCH_SIZE
const MAX_BATCH_SIZE = 25; // Max 25 articles par batch pour éviter les erreurs JSON

export async function categorizeWithClaudeBatch(articles) {
  if (!articles || articles.length === 0) {
    return [];
  }

  console.log(`\n🤖 CATÉGORISATION BATCH CLAUDE`);
  console.log(`   Articles à catégoriser: ${articles.length}`);

  // Si trop d'articles, diviser en plusieurs batches
  if (articles.length > MAX_BATCH_SIZE) {
    console.log(`   📦 Division en batches de ${MAX_BATCH_SIZE} articles max...`);
    
    const batches = [];
    for (let i = 0; i < articles.length; i += MAX_BATCH_SIZE) {
      batches.push(articles.slice(i, i + MAX_BATCH_SIZE));
    }
    
    console.log(`   📦 Nombre de batches: ${batches.length}`);
    
    // Traiter chaque batch séquentiellement (pour éviter rate limit)
    for (let i = 0; i < batches.length; i++) {
      console.log(`\n   🔄 Traitement batch ${i + 1}/${batches.length} (${batches[i].length} articles)...`);
      await processSingleBatch(batches[i], i + 1, batches.length);
    }
    
    return articles;
  }

  // Si moins de MAX_BATCH_SIZE articles, traiter en un seul batch
  await processSingleBatch(articles, 1, 1);
  return articles;
}

// Traiter un seul batch d'articles
async function processSingleBatch(articles, batchNum, totalBatches) {
  // Construire la liste des articles pour le prompt
  let articlesList = '';
  articles.forEach((article, index) => {
    articlesList += `
Article ${index + 1}:
Titre: ${article.title}
Description: ${(article.description || 'Aucune description').substring(0, 150)}
`;
  });

  const prompt = `Tu es un expert en catégorisation d'articles d'actualité positive.

Catégorise ces ${articles.length} articles dans UNE SEULE des catégories suivantes :
- ecologie (environnement, climat, biodiversité, énergie renouvelable)
- santé (médecine, bien-être, recherche médicale, santé publique)
- sciences-et-tech (technologie, innovation, IA, espace, découvertes scientifiques)
- social-et-culture (société, éducation, art, musique, solidarité, justice sociale)

${articlesList}

RÉPONDS UNIQUEMENT en JSON valide (un tableau, PAS de markdown, PAS de texte avant/après) :
[{"index":1,"category":"ecologie","raison":"courte"},{"index":2,"category":"santé","raison":"courte"}]

IMPORTANT: 
- Retourne EXACTEMENT ${articles.length} éléments
- Raisons TRÈS courtes (max 5 mots)
- JSON compact sur une seule ligne si possible`;

  try {
    const startTime = Date.now();
    
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 5000,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }]
    });

    const duration = Date.now() - startTime;
    const responseText = cleanJsonResponse(message.content[0].text);
    
    let results;
    try {
      results = JSON.parse(responseText);
    } catch (parseError) {
      console.error(`   ❌ Erreur parsing JSON batch ${batchNum}: ${parseError.message}`);
      console.error(`   Réponse (200 premiers chars): ${responseText.substring(0, 200)}...`);
      
      // Fallback: marquer tous comme uncategorized
      articles.forEach(article => {
        article.appCategory = 'uncategorized';
        article.categoryConfidence = 'low';
        article.categoryMethod = 'claude_batch_error';
      });
      return;
    }

    // Mapper les résultats aux articles
    let successCount = 0;
    let invalidCount = 0;
    
    for (const result of results) {
      const articleIndex = result.index - 1;
      if (articleIndex >= 0 && articleIndex < articles.length) {
        const article = articles[articleIndex];
        
        if (VALID_CATEGORIES.includes(result.category)) {
          article.appCategory = result.category;
          article.categoryConfidence = 'high';
          article.categoryMethod = 'claude_batch';
          article.categoryReason = result.raison;
          successCount++;
        } else {
          article.appCategory = 'uncategorized';
          article.categoryConfidence = 'low';
          article.categoryMethod = 'claude_batch_invalid';
          invalidCount++;
        }
      }
    }

    // Gérer les articles qui n'ont pas reçu de réponse
    const missingCount = articles.filter(a => !a.appCategory).length;
    articles.forEach(article => {
      if (!article.appCategory) {
        article.appCategory = 'uncategorized';
        article.categoryConfidence = 'low';
        article.categoryMethod = 'claude_batch_missing';
      }
    });

    // Logs de débrief pour ce batch
    console.log(`   ✅ Batch ${batchNum}/${totalBatches}: ${successCount}/${articles.length} catégorisés (${duration}ms)`);
    if (invalidCount > 0) console.log(`   ⚠️  Catégories invalides: ${invalidCount}`);
    if (missingCount > 0) console.log(`   ❌ Réponses manquantes: ${missingCount}`);

  } catch (error) {
    console.error(`   ❌ ERREUR BATCH ${batchNum}: ${error.message}`);
    
    // Fallback: marquer tous comme uncategorized
    articles.forEach(article => {
      article.appCategory = 'uncategorized';
      article.categoryConfidence = 'low';
      article.categoryMethod = 'claude_batch_error';
    });
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

    console.log(`  [Vérification] "${article.title.substring(0, 50)}..." -> ${response.confirmed ? 'CONFIRMÉ' : 'CORRIGÉ: ' + response.suggestedCategory} (${response.raison})`);
    return {
      confirmed: response.confirmed,
      suggestedCategory: response.suggestedCategory || keywordCategory,
      raison: response.raison
    };
  } catch (error) {
    console.error(`Erreur vérification Claude: ${error.message}`);
    // En cas d'erreur, on fait confiance aux mots-clés
    return { confirmed: true, suggestedCategory: keywordCategory, raison: 'Erreur API - confiance mots-clés par défaut' };
  }
}

// Fonction principale de catégorisation (uniquement mots-clés, Claude géré en batch)
export async function categorizeArticle(article) {
  await loadMappingConfig();

  // Essayer les mots-clés (analyse du contenu)
  const result = matchKeywords(article);

  if (result) {
    return {
      category: result.category,
      confidence: result.confidence,
      method: result.method
    };
  }

  // Si pas de match, retourner null (sera catégorisé par Claude en batch)
  return {
    category: null,
    confidence: null,
    method: 'needs_claude'
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
