import { fetchLatestNews, categorizeAndGroupNews } from './rss-parser.js';
import { generateArticle } from './article-generator.js';
import { supabase } from './supabase-client.js';
import { generateAudioForArticle } from '../src/services/audio-generator.js';
import { generateImageForArticle } from '../src/services/image-generator.js';
import { uploadAudioToSupabase, uploadImageToSupabase } from '../src/services/supabase-storage.js';
import { scoreAllCategories } from './positivity-scorer.js';
import { verifyCategoryWithClaude, logCategoryMismatch, logSelectedArticle } from './category-mapper.js';

async function generateDailyArticles() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const targetDate = tomorrow.toISOString().split('T')[0];

  // Statistiques globales
  let totalAudioCost = 0;
  let totalCharactersGenerated = 0;
  let audioSuccessCount = 0;
  let audioFailureCount = 0;

  let totalImageCost = 0;
  let imageSuccessCount = 0;
  let imageFailureCount = 0;

  try {
    // 1. Récupérer toutes les actualités des flux RSS
    const allNews = await fetchLatestNews();

    if (allNews.length === 0) {
      console.error('Aucune actualité récupérée');
      return;
    }

    // 2. Catégoriser et grouper par thème via mapping
    const groupedNews = await categorizeAndGroupNews(allNews);

    // 3. Récupérer les URLs déjà utilisées dans les 15 derniers jours (AVANT le scoring)
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
    const fifteenDaysAgoStr = fifteenDaysAgo.toISOString().split('T')[0];

    const { data: recentArticles } = await supabase
      .from('articles')
      .select('source_url')
      .gte('published_date', fifteenDaysAgoStr);

    const usedUrls = new Set(recentArticles?.map(a => a.source_url) || []);
    console.log(`URLs déjà utilisées dans les 15 derniers jours: ${usedUrls.size}`);

    // 4. Filtrer les articles disponibles par catégorie (qualité + non utilisés)
    const availableByCategory = {};
    for (const [category, articles] of Object.entries(groupedNews)) {
      const qualityArticles = articles.filter(article =>
        article.categoryConfidence === 'medium' || article.categoryConfidence === 'high'
      );
      const availableArticles = qualityArticles.filter(article => !usedUrls.has(article.url));
      
      if (availableArticles.length > 0) {
        availableByCategory[category] = availableArticles;
        console.log(`${category}: ${availableArticles.length} articles disponibles (${qualityArticles.length - availableArticles.length} déjà utilisés)`);
      } else {
        console.log(`${category}: Aucun article disponible`);
      }
    }

    // 5. Scorer la positivité de tous les articles disponibles (par catégorie, en parallèle)
    const scoredByCategory = await scoreAllCategories(availableByCategory);

    // 6. Sélectionner le meilleur article par catégorie avec vérification Claude
    const selectedArticles = {};
    for (const [category, articles] of Object.entries(scoredByCategory)) {
      if (!articles || articles.length === 0) continue;

      let selectedArticle = null;

      for (const candidate of articles) {
        if (candidate.categoryMethod === 'keyword_match') {
          // Vérifier avec Claude que la catégorie mots-clés est correcte
          console.log(`${category}: Vérification Claude pour "${candidate.title.substring(0, 50)}..."`);
          const verification = await verifyCategoryWithClaude(candidate, category);

          if (verification.confirmed) {
            selectedArticle = candidate;
            break;
          } else {
            // Log le mismatch pour ajuster les mots-clés dans le futur
            await logCategoryMismatch(candidate, category, verification.suggestedCategory);
            continue; // Passer au candidat suivant
          }
        } else {
          // Catégorisé par Claude directement → déjà fiable
          selectedArticle = candidate;
          break;
        }
      }

      if (selectedArticle) {
        selectedArticles[category] = selectedArticle;
        console.log(`${category}: Article sélectionné avec score ${selectedArticle.positivityScore}/100`);
      } else {
        console.log(`${category}: Aucun article validé après vérification Claude`);
      }
    }

    // Logger les articles sélectionnés pour analyse des sources
    for (const [category, article] of Object.entries(selectedArticles)) {
      await logSelectedArticle(article, category);
    }

    console.log(`\nArticles sélectionnés: ${Object.keys(selectedArticles).length} catégories`);

    // 7. Générer un article pour chaque catégorie
    const promptTypes = ['classic', 'immersif', 'qa'];
    let generatedCount = 0;
    let skippedCount = 0;

    for (const [category, newsItem] of Object.entries(selectedArticles)) {
  
    console.log(`\n${'='.repeat(60)}`);
    console.log(`--- Traitement: ${category} ---`);
    console.log('='.repeat(60));


      // Vérifier si un article existe déjà pour demain dans cette catégorie
      const { data: existing } = await supabase
        .from('articles')
        .select('id')
        .eq('published_date', targetDate)
        .eq('language', 'fr')
        .eq('category', category)
        .single();

      if (existing) {
        console.log(`Un article existe déjà pour ${category} pour la date ${targetDate}`);
        skippedCount++;
        continue;
      }

      console.log(`Article sélectionné: ${newsItem.title.substring(0, 60)}...`);
      console.log(`Score de positivité: ${newsItem.positivityScore}/100`);
      console.log(`Raison: ${newsItem.positivityReason}`);
      console.log(`Source: ${newsItem.source}`);
      console.log(`Catégorie: ${category}`);

      // Choisir un prompt aléatoire
      const randomPrompt = promptTypes[Math.floor(Math.random() * promptTypes.length)];
      console.log(` Génération avec prompt: ${randomPrompt}`);

      // Générer l'article avec Claude
      const articleContent = await generateArticle(newsItem, randomPrompt);

      // Extraire le titre et le contenu
      const titleMatch = articleContent.match(/\[TITRE\]\s*(.+)/);
      const contentMatch = articleContent.match(/\[CONTENU\]\s*([\s\S]+)/);
      
      const title = titleMatch ? titleMatch[1].trim() : newsItem.title;
      const content = contentMatch ? contentMatch[1].trim() : articleContent;

      console.log(`Article généré: ${title.substring(0, 50)}...`);

      // Insérer dans Supabase avec la date de demain
      const { data, error } = await supabase
        .from('articles')
        .insert({
          published_date: targetDate,
          language: 'fr',
          title: title,
          summary: newsItem.description.substring(0, 200),
          content: content,
          category: category,
          source_url: newsItem.url,
          audio_url: null, // Sera mis à jour après génération audio
          audio_format: null,
          image_url: null, // Sera mis à jour après génération image
        })
        .select();

      if (error) {
        console.error(`Erreur insertion Supabase pour ${category}:`, error);
        continue;
      }

      const insertedArticle = data[0];
      console.log(`Article sauvegardé (ID: ${insertedArticle.id})`);
      generatedCount++;

      // ========================================
      // GÉNÉRATION AUDIO
      // ========================================
      console.log(`\n${'🎙️'.repeat(20)}`);
      console.log('GÉNÉRATION AUDIO');
      console.log('🎙️'.repeat(20));

      try {
        // Générer l'audio (format choisi aléatoirement)
        const audioResult = await generateAudioForArticle({
          id: insertedArticle.id,
          content: content,
        });

        console.log(` Statistiques audio:`);
        console.log(`   Format: ${audioResult.format}`);
        console.log(`   Caractères: ${audioResult.characterCount}`);
        console.log(`   Coût: $${audioResult.cost.toFixed(4)}`);

        // Upload vers Supabase Storage
        const audioUrl = await uploadAudioToSupabase(
          audioResult.filepath,
          insertedArticle.id,
          targetDate,
          audioResult.format
        );

        // Mettre à jour l'article avec l'URL audio
        const { error: updateError } = await supabase
          .from('articles')
          .update({
            audio_url: audioUrl,
            audio_format: audioResult.format,
          })
          .eq('id', insertedArticle.id);

        if (updateError) {
          throw new Error(`Erreur update audio URL: ${updateError.message}`);
        }

        console.log(`Audio généré et uploadé avec succès`);
        console.log(`URL: ${audioUrl}`);

        // Stats
        totalAudioCost += audioResult.cost;
        totalCharactersGenerated += audioResult.characterCount;
        audioSuccessCount++;

      } catch (audioError) {
        console.error(` ERREUR GÉNÉRATION AUDIO pour l'article ${insertedArticle.id}:`);
        console.error(`   ${audioError.message}`);

        // Logger l'erreur (optionnel: on pourrait aussi la stocker en DB)
        console.log(`L'article ${insertedArticle.id} sera disponible SANS audio`);

        audioFailureCount++;
      }

      // ========================================
      // GÉNÉRATION IMAGE
      // ========================================
      console.log(`\nGÉNÉRATION IMAGE`);
      console.log('='.repeat(40));

      try {
        // Générer l'image avec Claude + Imagen
        const imageResult = await generateImageForArticle({
          id: insertedArticle.id,
          content: content,
          category: category,
        });

        console.log(`Statistiques image:`);
        console.log(`   Prompt: ${imageResult.prompt.substring(0, 50)}...`);
        console.log(`   Coût: $${imageResult.cost.toFixed(4)}`);

        // Upload vers Supabase Storage
        const imageUrl = await uploadImageToSupabase(
          imageResult.filepath,
          insertedArticle.id,
          targetDate
        );

        // Mettre à jour l'article avec l'URL image
        const { error: imageUpdateError } = await supabase
          .from('articles')
          .update({
            image_url: imageUrl,
          })
          .eq('id', insertedArticle.id);

        if (imageUpdateError) {
          throw new Error(`Erreur update image URL: ${imageUpdateError.message}`);
        }

        console.log(`Image générée et uploadée avec succès`);
        console.log(`URL: ${imageUrl}`);

        // Stats
        totalImageCost += imageResult.cost;
        imageSuccessCount++;

      } catch (imageError) {
        console.error(`ERREUR GÉNÉRATION IMAGE pour l'article ${insertedArticle.id}:`);
        console.error(`   ${imageError.message}`);

        console.log(`L'article ${insertedArticle.id} sera disponible SANS image`);

        imageFailureCount++;
      }

      console.log(`\n${'='.repeat(60)}\n`);

    }

    // ========================================
    // RÉSUMÉ FINAL
    // ========================================
    console.log('\n' + '='.repeat(60));
    console.log('RÉSUMÉ DE LA GÉNÉRATION');
    console.log('='.repeat(60));
    console.log(`ARTICLES:`);
    console.log(`   Générés: ${generatedCount}`);
    console.log(`   Ignorés (déjà existants): ${skippedCount}`);
    console.log(`   Total traités: ${generatedCount + skippedCount}`);
    
    console.log(`AUDIO:`);
    console.log(`   Succès: ${audioSuccessCount}`);
    console.log(`   Échecs: ${audioFailureCount}`);
    console.log(`   Taux de succès: ${generatedCount > 0 ? ((audioSuccessCount / generatedCount) * 100).toFixed(1) : 0}%`);

    console.log(`IMAGE:`);
    console.log(`   Succès: ${imageSuccessCount}`);
    console.log(`   Échecs: ${imageFailureCount}`);
    console.log(`   Taux de succès: ${generatedCount > 0 ? ((imageSuccessCount / generatedCount) * 100).toFixed(1) : 0}%`);

    console.log(`COÛTS:`);
    console.log(`   Caractères audio générés: ${totalCharactersGenerated.toLocaleString()}`);
    console.log(`   Coût total audio: $${totalAudioCost.toFixed(4)}`);
    console.log(`   Coût total image: $${totalImageCost.toFixed(4)}`);
    console.log(`   Coût total médias: $${(totalAudioCost + totalImageCost).toFixed(4)}`);
    
    console.log('\n' + '='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n💥 ERREUR GLOBALE:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Exécuter la génération et terminer le processus
generateDailyArticles()
  .then(() => {
    console.log('\n✅ Génération terminée avec succès');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Erreur lors de la génération:', error);
    process.exit(1);
  });