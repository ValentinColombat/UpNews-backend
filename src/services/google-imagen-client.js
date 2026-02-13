import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform';
import fs from 'fs';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);

// Style commun pour toutes les images UpNews
const UPNEWS_STYLE = `soft hand-drawn editorial illustration, warm and hopeful mood, pastel color palette, gentle brushstrokes, minimalist composition, clean background, no text, no logos, no watermarks`;

class GoogleImagenClient {
  constructor() {
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    this.location = 'us-central1'; // Région pour Imagen
    this.model = 'imagen-3.0-generate-001'; // Imagen 3 (plus stable)

    this.client = new PredictionServiceClient({
      apiEndpoint: `${this.location}-aiplatform.googleapis.com`,
    });

    this.endpoint = `projects/${this.projectId}/locations/${this.location}/publishers/google/models/${this.model}`;
  }

  /**
   * Génère une image avec Google Imagen
   * @param {string} subject - Sujet de l'image (ex: "A person recycling plastic bottles")
   * @param {object} options - Options de génération
   * @returns {Promise<Buffer>} - Buffer image PNG
   */
  async generateImage(subject, options = {}) {
    const {
      numberOfImages = 1,
      addStyle = true,
    } = options;

    // Construire le prompt complet avec le style UpNews
    const prompt = addStyle ? `${subject}, ${UPNEWS_STYLE}` : subject;

    // Format correct pour Vertex AI avec helpers protobuf
    const instanceValue = helpers.toValue({
      prompt: prompt,
    });

    const parametersValue = helpers.toValue({
      sampleCount: numberOfImages,
      aspectRatio: '16:9',
      safetyFilterLevel: 'block_few',
    });

    const request = {
      endpoint: this.endpoint,
      instances: [instanceValue],
      parameters: parametersValue,
    };

    try {
      console.log(`Génération image avec Imagen 3...`);
      console.log(`Prompt: ${prompt.substring(0, 100)}...`);

      const [response] = await this.client.predict(request);

      if (!response.predictions || response.predictions.length === 0) {
        throw new Error('Aucune image générée');
      }

      // Extraire l'image en base64
      const prediction = helpers.fromValue(response.predictions[0]);

      if (!prediction.bytesBase64Encoded) {
        throw new Error('Pas de données image dans la réponse');
      }

      const imageBuffer = Buffer.from(prediction.bytesBase64Encoded, 'base64');

      console.log(`Image générée avec succès`);
      return imageBuffer;
    } catch (error) {
      console.error('Erreur Google Imagen:', error.message);
      throw error;
    }
  }

  /**
   * Sauvegarde un buffer image dans un fichier
   * @param {Buffer} imageBuffer - Buffer image
   * @param {string} filepath - Chemin du fichier
   */
  async saveToFile(imageBuffer, filepath) {
    await writeFile(filepath, imageBuffer);
    console.log(`Image sauvegardée: ${filepath}`);
  }

  /**
   * Calcule le coût estimé pour une génération
   * @param {number} imageCount - Nombre d'images générées
   * @returns {number} - Coût en USD
   */
  calculateCost(imageCount = 1) {
    // Imagen 3: $0.03 par image
    const costPerImage = 0.03;
    return imageCount * costPerImage;
  }

  /**
   * Retourne le style UpNews pour référence
   * @returns {string}
   */
  getStyle() {
    return UPNEWS_STYLE;
  }
}

export const googleImagenClient = new GoogleImagenClient();
