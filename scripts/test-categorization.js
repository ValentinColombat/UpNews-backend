import { fetchLatestNews, categorizeAndGroupNews } from '../src/rss-parser.js';

async function testCategorization() {
  console.log('='.repeat(60));
  console.log('TEST CATÉGORISATION (sans génération)');
  console.log('='.repeat(60));

  // 1. Fetch RSS
  const allNews = await fetchLatestNews();
  console.log(`\nTotal articles récupérés: ${allNews.length}`);

  // 2. Catégoriser
  const grouped = await categorizeAndGroupNews(allNews);

  // 3. Stats détaillées
  console.log('\n' + '='.repeat(60));
  console.log('RÉSULTATS');
  console.log('='.repeat(60));

  let totalKeyword = 0;
  let totalClaude = 0;
  let totalUncategorized = 0;
  const sourcesStats = {};

  for (const [category, articles] of Object.entries(grouped)) {
    console.log(`\n--- ${category} (${articles.length} articles) ---`);

    for (const article of articles) {
      const method = article.categoryMethod;
      const conf = article.categoryConfidence;
      console.log(`  [${method}|${conf}] ${article.source} → "${article.title.substring(0, 60)}"`);

      if (method === 'keyword_match') totalKeyword++;
      else if (method === 'claude_categorization') totalClaude++;
      if (category === 'uncategorized') totalUncategorized++;

      // Stats par source
      if (!sourcesStats[article.source]) sourcesStats[article.source] = { total: 0, keyword: 0, claude: 0 };
      sourcesStats[article.source].total++;
      if (method === 'keyword_match') sourcesStats[article.source].keyword++;
      else if (method === 'claude_categorization') sourcesStats[article.source].claude++;
    }
  }

  // Résumé
  console.log('\n' + '='.repeat(60));
  console.log('RÉSUMÉ');
  console.log('='.repeat(60));
  console.log(`Total: ${allNews.length} articles`);
  console.log(`  Mots-clés: ${totalKeyword} (${Math.round(totalKeyword/allNews.length*100)}%)`);
  console.log(`  Claude:    ${totalClaude} (${Math.round(totalClaude/allNews.length*100)}%)`);
  console.log(`  Non catégorisés: ${totalUncategorized}`);

  console.log('\nArticles par source:');
  const sorted = Object.entries(sourcesStats).sort((a, b) => b[1].total - a[1].total);
  for (const [source, stats] of sorted) {
    console.log(`  ${source}: ${stats.total} articles (${stats.keyword} keyword, ${stats.claude} claude)`);
  }
}

testCategorization().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
