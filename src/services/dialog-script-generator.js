//Genere un script de dialogue podcast (format Lea/Alex) a partir d'un article,
// en utilisant Claude comme moteur de generation de texte.


import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../config/models.js';

// Client Anthropic initialise une seule fois (singleton du module)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

//Genere un script dialogue "podcast" depuis le contenu d'un article.

export async function generateDialogScriptFromArticle(article) {
  if (!article?.content) {
    throw new Error('generateDialogScriptFromArticle: article.content manquant');
  }

  // Ce prompt est concu pour obtenir un format de sortie tres predictible.
  // Les regles strictes reduisent le besoin de post-traitement et evitent
  // les hallucinations de format (markdown parasite, intro "Bonjour", etc.)
  const prompt = `Tu es un producteur de podcast pour UpNews.

Transforme cet article en dialogue naturel entre deux présentateurs français :

- Léa : animatrice enthousiaste, accessible, porte l'émotion (optimiste)
- Alex : expert contextuel, posé, apporte la profondeur (bienveillant)

RÈGLES STRICTES DE FORMAT :
- NOMBRE DE RÉPLIQUES : MINIMUM 8, MAXIMUM 12 répliques
- AVANT de finaliser ta réponse, COMPTE tes répliques ligne par ligne
- Si tu en as moins de 8, AJOUTE des échanges pour atteindre 8 minimum
- Répliques courtes : 2-3 phrases max chacune
- Commencer par Léa qui annonce la bonne nouvelle
- Terminer par Léa sur une note d'espoir
- Ton : informatif ET optimiste, jamais anxiogène
- Durée cible à l'oral : 2 à 3 minutes

FORMAT DE SORTIE OBLIGATOIRE :
- AUCUN titre, AUCUNE balise, AUCUNE liste, AUCUN markdown
- AUCUNE intro du type "Bonjour", "Salut", ou formule d'accueil
- Format EXACT : une réplique par ligne, uniquement :
  Léa: [texte de la réplique]
  Alex: [texte de la réplique]
  Léa: [texte de la réplique]
  ...

ARTICLE À TRANSFORMER :
${article.content}

RAPPEL : Vérifie que tu as AU MOINS 8 répliques avant de répondre.
`;

  try {
    const message = await anthropic.messages.create({
      model: MODELS.articleGeneration,
      max_tokens: 1800,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message?.content?.[0]?.text ?? '';

    // Normalisation et validation stricte avant de retourner le transcript
    const transcript = normalizeAndValidateDialogTranscript(raw);

    console.log(`   Script dialogue : ${transcript.split('\n').length} repliques generees`);
    return transcript;

  } catch (error) {
    console.error('[DialogScript] Erreur generation script (Claude):', error.message);
    throw error;
  }
}

/**
 * Normalise et valide le transcript brut produit par Claude.
 *
 * Pourquoi cette etape ?
 * Claude peut parfois ajouter des artefacts ("TRANSCRIPT:", lignes vides,
 * espaces en debut de ligne, retours chariot Windows \r\n). Cette fonction
 * nettoie ces cas avant de valider le format attendu par Gemini TTS.
 *
 * Regles de validation :
 *   1. Entre 8 et 14 lignes (8-12 cibles, 13-14 toleres)
 *   2. Chaque ligne commence par "Lea:" ou "Alex:"
 *   3. Les deux speakers sont presents au moins une fois
 *
 * @param {string} raw - Texte brut retourne par Claude
 * @returns {string} Transcript nettoye et valide
 * @throws {Error} Si le format ne respecte pas les regles ci-dessus
 */
function normalizeAndValidateDialogTranscript(raw) {
  const cleaned = (raw || '')
    .replace(/\r\n/g, '\n')        // Normaliser les fins de ligne Windows
    .split('\n')
    .map((l) => l.trim())           // Supprimer les espaces parasites en debut/fin
    .filter(Boolean)                // Supprimer les lignes vides
    // Claude ajoute parfois un prefixe "TRANSCRIPT:" ou "Transcript:" — on l'ignore
    .filter((l) => !/^transcript\s*:/i.test(l))
    .join('\n');

  const lines = cleaned.split('\n').filter(Boolean);

  // Validation du nombre de repliques
  // On tolere de 7 a 14 lignes (cible 8-12, mais Claude peut varier)
  if (lines.length < 7 || lines.length > 14) {
    throw new Error(
      `Transcript dialogue invalide: ${lines.length} lignes (attendu 8-12, tolere 7-14).\nSortie brute:\n${cleaned}`
    );
  }

  let hasLea = false;
  let hasAlex = false;

  for (const line of lines) {
    // Chaque ligne DOIT commencer par "Lea:" ou "Alex:" — c'est le format
    // que Gemini TTS utilise pour attribuer les voix aux bons speakers
    const ok = line.startsWith('Léa:') || line.startsWith('Alex:');
    if (!ok) {
      throw new Error(
        `Transcript invalide: ligne ne commencant pas par "Lea:" ou "Alex:".\nLigne fautive: ${line}\n\nTranscript complet:\n${cleaned}`
      );
    }
    if (line.startsWith('Léa:')) hasLea = true;
    if (line.startsWith('Alex:')) hasAlex = true;
  }

  // Les deux speakers doivent etre presents pour avoir un vrai dialogue
  if (!hasLea || !hasAlex) {
    throw new Error(
      `Transcript invalide: Lea et Alex doivent tous les deux apparaitre.\nTranscript complet:\n${cleaned}`
    );
  }

  return cleaned;
}
