import { supabase } from '../supabase-client.js';
import fs from 'fs';
import sharp from 'sharp';

/**
 * Upload un fichier image vers Supabase Storage
 * @param {string} filepath - Chemin local du fichier
 * @param {string} articleId - ID de l'article
 * @param {string} publishedDate - Date de publication (YYYY-MM-DD)
 * @returns {Promise<string>} - URL publique du fichier
 */
export async function uploadImageToSupabase(filepath, articleId, publishedDate) {
  try {
    console.log(`\nUpload image vers Supabase Storage...`);

    // Lire et compresser l'image (cible ~200KB)
    const rawBuffer = fs.readFileSync(filepath);
    const originalKB = Math.round(rawBuffer.length / 1024);

    let fileBuffer, contentType, ext;
    try {
      fileBuffer = await sharp(rawBuffer)
        .resize({ width: 1024, withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
      contentType = 'image/jpeg';
      ext = 'jpg';
      const compressedKB = Math.round(fileBuffer.length / 1024);
      console.log(`Compression image: ${originalKB}KB -> ${compressedKB}KB`);
    } catch (sharpError) {
      console.warn(`Compression échouée (${sharpError.message}), upload du fichier original (${originalKB}KB)`);
      fileBuffer = rawBuffer;
      contentType = 'image/png';
      ext = 'png';
    }

    // Construire le chemin dans le bucket
    const storagePath = `${publishedDate}/article_${articleId}.${ext}`;

    // Upload vers Supabase
    const { data, error } = await supabase.storage
      .from('article-images')
      .upload(storagePath, fileBuffer, {
        contentType,
        upsert: false,
      });

    if (error) {
      throw new Error(`Erreur upload image Supabase: ${error.message}`);
    }

    // Récupérer l'URL publique
    const { data: { publicUrl } } = supabase.storage
      .from('article-images')
      .getPublicUrl(storagePath);

    console.log(`Upload image réussi: ${publicUrl}`);

    // Supprimer le fichier temporaire
    fs.unlinkSync(filepath);
    console.log(`Fichier image temporaire supprimé`);

    return publicUrl;
  } catch (error) {
    console.error('Erreur upload image Supabase:', error.message);
    throw error;
  }
}

/**
 * Upload un fichier audio vers Supabase Storage
 * @param {string} filepath - Chemin local du fichier
 * @param {string} articleId - ID de l'article
 * @param {string} publishedDate - Date de publication (YYYY-MM-DD)
 * @param {string} format - 'simple' ou 'podcast'
 * @returns {Promise<string>} - URL publique du fichier
 */
export async function uploadAudioToSupabase(filepath, articleId, publishedDate, format) {
  try {
    console.log(`\n📤 Upload vers Supabase Storage...`);

    // Lire le fichier
    const fileBuffer = fs.readFileSync(filepath);

    // Construire le chemin dans le bucket
    const storagePath = `${publishedDate}/article_${articleId}_${format}.mp3`;

    // Upload vers Supabase
    const { data, error } = await supabase.storage
      .from('article-audios')
      .upload(storagePath, fileBuffer, {
        contentType: 'audio/mpeg',
        upsert: false, // Ne pas écraser si existe déjà
      });

    if (error) {
      throw new Error(`Erreur upload Supabase: ${error.message}`);
    }

    // Récupérer l'URL publique
    const { data: { publicUrl } } = supabase.storage
      .from('article-audios')
      .getPublicUrl(storagePath);

    console.log(` Upload réussi: ${publicUrl}`);

    // Supprimer le fichier temporaire
    fs.unlinkSync(filepath);
    console.log(` Fichier temporaire supprimé`);

    return publicUrl;
  } catch (error) {
    console.error(' Erreur upload Supabase:', error.message);
    throw error;
  }
}