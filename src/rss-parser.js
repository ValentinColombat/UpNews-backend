import Parser from 'rss-parser';
import { readFile } from 'fs/promises';
import { categorizeArticle, groupArticlesByCategory } from './category-mapper.js';

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
  console.log('\nCatégorisation des articles...');

  // Catégoriser chaque article avec le mapping statique
  let claudeCount = 0;
  let keywordCount = 0;
  for (const article of newsList) {
    const result = await categorizeArticle(article);
    article.appCategory = result.category;
    article.categoryConfidence = result.confidence;
    article.categoryMethod = result.method;
    if (result.method === 'claude_categorization') claudeCount++;
    else if (result.method === 'keyword_match') keywordCount++;
  }

  console.log(`Catégorisation terminée: ${keywordCount} par mots-clés, ${claudeCount} par Claude (sur ${newsList.length} articles)`);

  // Grouper par catégorie
  const grouped = groupArticlesByCategory(newsList);

  // Afficher les stats
  console.log('\nRépartition par catégorie:');
  for (const [category, articles] of Object.entries(grouped)) {
    if (articles.length > 0) {
      console.log(`  ${category}: ${articles.length} articles`);
    }
  }

  return grouped;
}

export function selectBestNews(newsList) {
  // Pour l'instant : sélection aléatoire
  // Plus tard : scoring basé sur pertinence, positivité, etc.
  const randomIndex = Math.floor(Math.random() * newsList.length);
  return newsList[randomIndex];
}