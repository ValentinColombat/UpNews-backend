import Anthropic from '@anthropic-ai/sdk';
import { prompts } from './prompts.js';
import dotenv from 'dotenv';
import { MODELS } from './config/models.js';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export async function generateArticle(newsItem, promptType = 'classic') {
  console.log(`Génération avec le prompt: ${promptType}`);
  
  // Remplacer les placeholders dans le prompt
  const prompt = prompts[promptType]
    .replace(/{title}/g, newsItem.title)
    .replace(/{description}/g, newsItem.description)
    .replace(/{url}/g, newsItem.url);
  
  // Appel à Claude API
  const message = await anthropic.messages.create({
    model: MODELS.articleGeneration,
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });
  
  return message.content[0].text;
}