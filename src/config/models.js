/**
 * Configuration centralisée des modèles Claude
 * 
 * Pour mettre à jour les modèles, modifiez uniquement ce fichier.
 * Documentation: https://docs.anthropic.com/en/docs/about-claude/models
 */

export const CLAUDE_MODELS = {
  // Modèle rapide et économique (catégorisation, scoring, tâches simples)
  FAST: 'claude-haiku-4-5-20251001',
  
  // Modèle équilibré (génération d'articles, rédaction)
  BALANCED: 'claude-sonnet-4-20250514',
  
  // Modèle puissant (tâches complexes, analyse approfondie)
  POWERFUL: 'claude-sonnet-4-20250514',
};

// Alias pour clarifier l'usage
export const MODELS = {
  categorization: CLAUDE_MODELS.FAST,
  positivityScoring: CLAUDE_MODELS.FAST,
  articleGeneration: CLAUDE_MODELS.BALANCED,
  imagePrompt: CLAUDE_MODELS.FAST,
};
