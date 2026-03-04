import Parser from 'rss-parser';
import { readFile } from 'fs/promises';
import { categorizeArticle, groupArticlesByCategory, categorizeWithClaudeBatch } from './category-mapper.js';

const parser = new Parser();

export async function fetchLatestNews() {
  console.log('Récupération des flux RSS...');

  // Charger les sources depuis le fichier JSON
  const sourcesFile = await readFile('./data/rss-sources.json', 'utf-8');
  const { sources } = JSON.parse(sourcesFile);

  const allNews = [];

  for (const source of sources) {
    try {
      const feed = await parser.parseURL(source.url);

      // Prendre les 3 articles les plus récents de chaque source
      const recentItems = feed.items.slice(0, 3).map(item => ({
          title: item.title,
          description: item.contentSnippet || item.description || item.summary || '',
          url: item.link,
          source: source.name,
          pubDate: item.pubDate || new Date().toISOString()
      }));

      allNews.push(...recentItems);
      console.log(`  ${source.name}: ${recentItems.length} articles`);

    } catch (error) {
      console.error(`  Erreur avec ${source.name}:`, error.message);
    }
  }

  console.log(`\nTotal: ${allNews.length} actualités récupérées`);
  return allNews;
}

// Catégoriser tous les articles et les grouper par thème
export async function categorizeAndGroupNews(newsList) {
  console.log('\n' + '='.repeat(60));
  console.log('📂 CATÉGORISATION DES ARTICLES');
  console.log('='.repeat(60));
  console.log(`   Total articles à traiter: ${newsList.length}`);

  const startTime = Date.now();

  // ÉTAPE 1: Catégoriser par mots-clés (gratuit et rapide)
  console.log('\n🔤 ÉTAPE 1: Catégorisation par mots-clés...');
  
  const categorizedByKeywords = [];
  const needsClaudeCategorization = [];

  for (const article of newsList) {
    const result = await categorizeArticle(article);
    
    if (result.method === 'keyword_match') {
      // Mots-clés ont trouvé → pas besoin de Claude
      article.appCategory = result.category;
      article.categoryConfidence = result.confidence;
      article.categoryMethod = result.method;
      categorizedByKeywords.push(article);
    } else {
      // Pas de match → à envoyer à Claude
      needsClaudeCategorization.push(article);
    }
  }

  console.log(`   ✅ Catégorisés par mots-clés: ${categorizedByKeywords.length}`);
  console.log(`   ⏳ À envoyer à Claude: ${needsClaudeCategorization.length}`);

  // ÉTAPE 2: Catégoriser les articles restants avec Claude en BATCH (1 seule requête)
  let claudeBatchCount = 0;
  let claudeErrorCount = 0;

  if (needsClaudeCategorization.length > 0) {
    console.log('\n🤖 ÉTAPE 2: Catégorisation batch Claude...');
    
    await categorizeWithClaudeBatch(needsClaudeCategorization);
    
    // Compter les résultats
    needsClaudeCategorization.forEach(article => {
      if (article.categoryMethod === 'claude_batch') {
        claudeBatchCount++;
      } else if (article.categoryMethod?.includes('error') || article.categoryMethod?.includes('invalid') || article.categoryMethod?.includes('missing')) {
        claudeErrorCount++;
      }
    });
  } else {
    console.log('\n🤖 ÉTAPE 2: Aucun article à envoyer à Claude (tous catégorisés par mots-clés) ✨');
  }

  const duration = Date.now() - startTime;

  // Grouper par catégorie
  const grouped = groupArticlesByCategory(newsList);

  // DÉBRIEF FINAL - Répartition uniquement
  console.log('\n' + '='.repeat(60));
  console.log('� RÉPARTITION FINALE PAR CATÉGORIE');
  console.log('='.repeat(60));
  for (const [category, articles] of Object.entries(grouped)) {
    if (articles.length > 0) {
      const percentage = ((articles.length/newsList.length)*100).toFixed(1);
      console.log(`      ${category}: ${articles.length} articles (${percentage}%)`);
    }
  }
  console.log('='.repeat(60) + '\n');

  return grouped;
}

export function selectBestNews(newsList) {
  // Pour l'instant : sélection aléatoire
  // Plus tard : scoring basé sur pertinence, positivité, etc.
  const randomIndex = Math.floor(Math.random() * newsList.length);
  return newsList[randomIndex];
}