import Anthropic from '@anthropic-ai/sdk';
import { appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';
import { MODELS } from './config/models.js';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Logger les scores pour analyse
async function logPositivityScores(category, scoredArticles) {
  const logDir = './logs';
  const logFile = join(logDir, 'positivity-scores.log');

  // Créer le dossier logs s'il n'existe pas
  if (!existsSync(logDir)) {
    await mkdir(logDir, { recursive: true });
  }

  const logEntry = {
    timestamp: new Date().toISOString(),
    category: category,
    articlesCount: scoredArticles.length,
    scores: scoredArticles.map(article => ({
      title: article.title.substring(0, 60),
      score: article.positivityScore,
      reason: article.positivityReason
    }))
  };

  await appendFile(logFile, JSON.stringify(logEntry) + '\n');
}

/**
 * Score tous les articles d'une catégorie par positivité en un seul appel API
 * @param {Array} articles - Liste d'articles à scorer
 * @param {string} category - Nom de la catégorie
 * @returns {Array} Articles triés par score décroissant avec propriétés .positivityScore et .positivityReason
 */
export async function scoreArticlesByPositivity(articles, category) {
  if (!articles || articles.length === 0) {
    console.log(`Aucun article à scorer pour ${category}`);
    return [];
  }

  console.log(`\n🎯 Scoring de positivité pour ${category} (${articles.length} articles)`);

  // Construire le prompt avec tous les articles
  let articlesText = '';
  articles.forEach((article, index) => {
    articlesText += `
Article ${index + 1}:
Titre: ${article.title}
Description: ${article.description || 'Aucune description'}

`;
  });

  const prompt = `Tu es un expert en analyse de sentiment et de positivité dans les actualités.

Ta mission : analyser ces ${articles.length} articles de la catégorie "${category}" et attribuer à chacun un score de positivité de 0 à 100.

CRITÈRES DE POSITIVITÉ (de 0 à 100) :
- 90-100 : Très positif (innovation majeure, impact social fort, progrès significatif)
- 70-89 : Positif (amélioration concrète, bonne nouvelle claire)
- 50-69 : Modérément positif (aspect positif avec quelques nuances)
- 30-49 : Neutre avec légère connotation positive
- 0-29 : Peu ou pas positif (neutre, négatif, ou controversé)

CONSIGNES :
- Privilégie les articles avec un impact concret et mesurable
- Valorise l'innovation, le progrès social, la solidarité, les avancées scientifiques
- Pénalise les articles sensationnalistes sans fond
- Évite les articles polémiques ou avec aspects négatifs dominants
- Sois strict : seuls les vrais articles positifs doivent avoir 70+

ARTICLES À ANALYSER :
${articlesText}

RÉPONDS UNIQUEMENT en JSON valide (pas de markdown, pas de \`\`\`json) :
[
  {"index": 1, "score": 85, "raison": "Innovation technologique avec impact environnemental positif"},
  {"index": 2, "score": 72, "raison": "Progrès social concret pour une communauté"}
]`;

  try {
    // Appel à Claude API
    const startTime = Date.now();
    console.log(`   📤 Envoi requête Claude...`);
    
    const message = await anthropic.messages.create({
      model: MODELS.positivityScoring,
      max_tokens: 2000,
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const duration = Date.now() - startTime;
    console.log(`   📥 Réponse reçue en ${duration}ms`);
    console.log(`   💰 Tokens: ${message.usage?.input_tokens || 'N/A'} in / ${message.usage?.output_tokens || 'N/A'} out`);

    // Nettoyer la réponse (supprime les backticks markdown si présents)
    const rawText = message.content[0].text.trim();
    const responseText = rawText.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
    
    // Parser le JSON
    let scores;
    try {
      scores = JSON.parse(responseText);
      console.log(`   ✅ JSON parsé avec succès (${scores.length} scores)`);
    } catch (parseError) {
      console.error('   ❌ Erreur parsing JSON:', parseError.message);
      console.error('   Réponse brute (200 premiers chars):', responseText.substring(0, 200));
      throw new Error('Réponse Claude invalide');
    }

    // Vérifier que nous avons bien des scores
    if (!Array.isArray(scores) || scores.length !== articles.length) {
      console.warn(`⚠️ Nombre de scores (${scores.length}) différent du nombre d'articles (${articles.length})`);
    }

    // Attacher les scores aux articles
    const scoredArticles = articles.map((article, index) => {
      const scoreData = scores.find(s => s.index === index + 1);
      
      return {
        ...article,
        positivityScore: scoreData?.score || 0,
        positivityReason: scoreData?.raison || 'Score non disponible'
      };
    });

    // Trier par score décroissant
    scoredArticles.sort((a, b) => b.positivityScore - a.positivityScore);

    // Stats de distribution des scores
    const highScore = scoredArticles.filter(a => a.positivityScore >= 70).length;
    const mediumScore = scoredArticles.filter(a => a.positivityScore >= 50 && a.positivityScore < 70).length;
    const lowScore = scoredArticles.filter(a => a.positivityScore < 50).length;
    console.log(`   📊 Distribution: ${highScore} positifs (70+) | ${mediumScore} moyens (50-69) | ${lowScore} faibles (<50)`);

    // Logger les résultats
    await logPositivityScores(category, scoredArticles);

    // Afficher le top 3
    console.log(`\n📊 Top 3 des articles les plus positifs :`);
    scoredArticles.slice(0, 3).forEach((article, i) => {
      console.log(`   ${i + 1}. [${article.positivityScore}/100] ${article.title.substring(0, 60)}...`);
      console.log(`      → ${article.positivityReason}`);
    });

    return scoredArticles;

  } catch (error) {
    console.error(`❌ Erreur scoring pour ${category}:`, error.message);
    
    // En cas d'erreur, retourner les articles sans score (fallback)
    return articles.map(article => ({
      ...article,
      positivityScore: 50, // Score neutre par défaut
      positivityReason: 'Erreur de scoring - article non évalué'
    }));
  }
}

/**
 * Score toutes les catégories en parallèle
 * @param {Object} groupedArticles - Articles groupés par catégorie
 * @returns {Object} Articles groupés par catégorie avec scores de positivité
 */
export async function scoreAllCategories(groupedArticles) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('🎯 SCORING DE POSITIVITÉ - TOUTES CATÉGORIES');
  console.log('='.repeat(60));

  const startTime = Date.now();
  const scoringPromises = [];
  const categories = Object.keys(groupedArticles);

  // Compter le total d'articles
  let totalArticles = 0;
  for (const category of categories) {
    const articles = groupedArticles[category];
    if (articles && articles.length > 0) {
      totalArticles += articles.length;
    }
  }
  console.log(`📝 Total articles à scorer: ${totalArticles} (${categories.length} catégories)`);
  console.log(`📡 Requêtes API: ${categories.length} (en parallèle)\n`);

  // Lancer le scoring en parallèle pour toutes les catégories
  for (const category of categories) {
    const articles = groupedArticles[category];
    if (articles && articles.length > 0) {
      scoringPromises.push(
        scoreArticlesByPositivity(articles, category)
          .then(scored => ({ category, scored }))
      );
    }
  }

  // Attendre que tous les scorings soient terminés
  const results = await Promise.all(scoringPromises);

  // Reconstruire l'objet groupé avec les articles scorés
  const scoredGroupedArticles = {};
  results.forEach(({ category, scored }) => {
    scoredGroupedArticles[category] = scored;
  });

  const duration = Date.now() - startTime;

  // Résumé final
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 RÉSUMÉ SCORING POSITIVITÉ');
  console.log('='.repeat(60));
  console.log(`   ⏱️  Temps total: ${duration}ms (${(duration/1000).toFixed(1)}s)`);
  console.log(`   📡 Requêtes API: ${results.length}`);
  
  // Meilleur article par catégorie
  console.log(`\n   🏆 Meilleur article par catégorie:`);
  for (const { category, scored } of results) {
    if (scored.length > 0) {
      const best = scored[0];
      console.log(`      ${category}: [${best.positivityScore}/100] ${best.title.substring(0, 45)}...`);
    }
  }
  console.log('='.repeat(60));

  return scoredGroupedArticles;
}
