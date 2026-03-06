import 'dotenv/config';
import { generateDialogScriptFromArticle } from '../src/services/dialog-script-generator.js';

async function main() {
  const article = {
    content: `Une équipe de chercheurs a mis au point une nouvelle méthode de recyclage du plastique
qui permet de réutiliser des matériaux complexes avec moins d'énergie. Les tests montrent une réduction
importante des déchets et une amélioration du coût de traitement, ce qui pourrait accélérer
l'adoption de la technologie par les collectivités locales. Plusieurs villes envisagent un pilote dès 2026.`,
  };

  const transcript = await generateDialogScriptFromArticle(article);
  console.log('\n=== DIALOGUE TRANSCRIPT ===\n');
  console.log(transcript);
  console.log('\n==========================\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});