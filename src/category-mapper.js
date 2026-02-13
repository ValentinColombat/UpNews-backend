import { readFile, appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

let mappingConfig = null;

// Charger la configuration au démarrage
async function loadMappingConfig() {
  if (!mappingConfig) {
    const configFile = await readFile('./data/category-mapping.json', 'utf-8');
    mappingConfig = JSON.parse(configFile);
  }
  return mappingConfig;
}

// Logger les catégorisations pour analyse
async function logCategorization(article, category, method, confidence) {
  const logDir = './logs';
  const logFile = join(logDir, 'categorization.log');

  // Créer le dossier logs s'il n'existe pas
  if (!existsSync(logDir)) {
    await mkdir(logDir, { recursive: true });
  }

  const logEntry = {
    timestamp: new Date().toISOString(),
    title: article.title,
    sourceCategory: article.category,
    assignedCategory: category,
    method: method, // Dans l'ordre : 'source_mapping', 'keyword_match', 'fallback'
    confidence: confidence, // 'high', 'medium', 'low'
    source: article.source,
    url: article.url
  };

  await appendFile(logFile, JSON.stringify(logEntry) + '\n');
}

// Mapper une catégorie source vers une catégorie app
function mapSourceCategory(sourceCategory) {
  const config = mappingConfig;
  const normalized = sourceCategory?.toLowerCase().trim();

  if (config.source_categories[normalized]) {
    return {
      category: config.source_categories[normalized],
      method: 'source_mapping',
      confidence: 'high'
    };
  }

  return null;
}

// Chercher des mots-clés dans le titre et la description
function matchKeywords(article) {
  const config = mappingConfig;
  const text = `${article.title} ${article.description}`.toLowerCase();

  const scores = {};

  // Compter les mots-clés de chaque catégorie
  for (const [category, keywords] of Object.entries(config.keyword_patterns)) {
    scores[category] = 0;

    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        scores[category]++;
      }
    }
  }

  // Trouver la catégorie avec le plus de matches (minimum 2 mots-clés requis)
  const sortedCategories = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .filter(([_, score]) => score >= 2);

  if (sortedCategories.length === 0) {
    return null;
  }

  const [bestCategory, bestScore] = sortedCategories[0];

  // Déterminer le niveau de confiance (minimum 2 mots-clés déjà garanti par le filtre)
  const confidence = bestScore >= 3 ? 'high' : 'medium';

  return {
    category: bestCategory,
    method: 'keyword_match',
    confidence: confidence,
    matchCount: bestScore
  };
}

// Fonction principale de catégorisation
export async function categorizeArticle(article) {
  const config = await loadMappingConfig();

  // 1. Essayer le mapping de catégorie source (sauf si "absent")
  let result = null;
  if (article.category && article.category !== 'absent') {
    result = mapSourceCategory(article.category);
  }

  // 2. Si pas de match ou catégorie "absent", essayer les mots-clés (analyse du contenu)
  if (!result) {
    result = matchKeywords(article);
  }

  // 3. Si toujours pas de match, utiliser le fallback par défaut
  if (!result) {
    result = {
      category: config.fallback_category,
      method: 'fallback',
      confidence: 'low'
    };
  }

  // Logger la catégorisation
  await logCategorization(article, result.category, result.method, result.confidence);

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

// Sélectionner un article aléatoire par catégorie (uniquement confiance medium/high)
export function selectRandomArticlePerCategory(groupedArticles) {
  const selected = {};

  for (const [category, articles] of Object.entries(groupedArticles)) {
    // Filtrer uniquement les articles avec confiance medium ou high
    const qualityArticles = articles.filter(article =>
      article.categoryConfidence === 'medium' || article.categoryConfidence === 'high'
    );

    if (qualityArticles.length > 0) {
      const randomIndex = Math.floor(Math.random() * qualityArticles.length);
      selected[category] = qualityArticles[randomIndex];
    }
  }

  return selected;
}
