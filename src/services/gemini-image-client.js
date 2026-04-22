import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);

const MODEL = 'gemini-2.5-flash-image';
const COST_PER_IMAGE = 0.039;

// Style commun pour toutes les images UpNews
const UPNEWS_STYLE = `soft hand-drawn editorial illustration, warm and hopeful mood, pastel color palette, gentle brushstrokes, minimalist composition, clean background, no text, no logos, no watermarks, wide landscape format`;

class GeminiImageClient {
  constructor() {
    // Mode Vertex AI : utilise GOOGLE_APPLICATION_CREDENTIALS automatiquement
    this.ai = new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT_ID,
      location: 'us-central1',
    });
  }

  async generateImage(subject, options = {}) {
    const { addStyle = true } = options;
    const prompt = addStyle ? `${subject}, ${UPNEWS_STYLE}` : subject;

    console.log(`Génération image avec Gemini 2.5 Flash...`);
    console.log(`Prompt: ${prompt.substring(0, 100)}...`);

    const response = await this.ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseModalities: ['IMAGE'],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find(p => p.inlineData);

    if (!imagePart?.inlineData?.data) {
      throw new Error('Aucune image dans la réponse Gemini');
    }

    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');

    if (imageBuffer.length === 0) {
      throw new Error('Image générée vide (buffer 0 octet)');
    }

    console.log(`Image générée avec succès (${imageBuffer.length} bytes)`);
    return imageBuffer;
  }

  async saveToFile(imageBuffer, filepath) {
    await writeFile(filepath, imageBuffer);
    console.log(`Image sauvegardée: ${filepath}`);
  }

  calculateCost(imageCount = 1) {
    return imageCount * COST_PER_IMAGE;
  }

  getStyle() {
    return UPNEWS_STYLE;
  }
}

export const geminiImageClient = new GeminiImageClient();
