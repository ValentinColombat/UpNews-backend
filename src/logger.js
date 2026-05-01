import { appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_FILE = join(__dirname, '../logs/rss-usage.jsonl');

export async function logRssUsage(article, category) {
  const entry = {
    date: new Date().toISOString().split('T')[0],
    source: article.source,
    source_url: article.url,
    category,
    title: article.title,
  };

  if (!existsSync(join(__dirname, '../logs'))) {
    await mkdir(join(__dirname, '../logs'), { recursive: true });
  }

  await appendFile(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
}
