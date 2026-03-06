# UpNews — Backend

Backend de generation automatique d'articles et de podcasts audio pour l'application UpNews.

Chaque nuit (4h heure francaise), un workflow GitHub Actions :
1. Collecte les actualites positives depuis des flux RSS
2. Selectionne le meilleur article par categorie (scoring positivite via Claude)
3. Redige un article optimise avec Claude
4. Genere un podcast audio dialogue Lea/Alex (Gemini TTS)
5. Genere une image illustrative (Google Imagen 3)
6. Publie tout dans Supabase (base de donnees + stockage fichiers)

---

## Architecture des fichiers

```
src/
├── index.js                        # Point d'entree — orchestre la generation quotidienne
├── rss-parser.js                   # Collecte et categorisation des flux RSS
├── article-generator.js            # Generation d'articles avec Claude
├── positivity-scorer.js            # Scoring de positivite des articles (Claude)
├── category-mapper.js              # Verification et mapping des categories (Claude)
├── prompts.js                      # Templates de prompts Claude
├── supabase-client.js              # Client Supabase
├── config/
│   ├── models.js                   # Configuration centralisee des modeles Claude
│   └── google-cloud-credentials.json  # Credentials Vertex AI (non versionne, .gitignore)
└── services/
    ├── audio-generator.js          # Orchestrateur pipeline audio (unique point d'entree)
    ├── dialog-script-generator.js  # Generation du script dialogue Lea/Alex (Claude)
    ├── gemini-tts-client.js        # Synthese vocale multi-speaker (Gemini TTS)
    ├── audio-converter.js          # Conversion PCM brut -> MP3 (ffmpeg)
    ├── image-generator.js          # Orchestrateur generation image
    ├── google-imagen-client.js     # Generation d'images (Google Imagen 3 via Vertex AI)
    └── supabase-storage.js         # Upload fichiers vers Supabase Storage

scripts/
├── test-dialog-script.js           # Test isole : generation du script dialogue
├── test-gemini-tts.js              # Test isole : synthese vocale + conversion MP3
├── test-categorization.js          # Test isole : categorisation des articles
└── log-analyzer.js                 # Analyse des logs de generation
```

---

## Pipeline audio — comment ca marche

Le pipeline audio genere un podcast dialogue (format Lea/Alex) en 3 etapes successives.
Chaque etape est isolee dans son propre fichier avec une responsabilite unique.

```
Article (texte brut)
        |
        v
[ETAPE 1] dialog-script-generator.js
  Claude transforme l'article en transcript dialogue :
    "Lea: Bonjour, voici une excellente nouvelle..."
    "Alex: Effectivement, et ce qui est remarquable..."
    ...
  Regles : 8-14 repliques, format strict Lea:/Alex:, ~2-3 min a l'oral

        |
        v
[ETAPE 2] gemini-tts-client.js
  buildDialogTtsPrompt() enveloppe le transcript dans un "Audio Profile"
  (Director's Notes : style podcast, accent francais, pauses naturelles)

  generatePcmWithGeminiTts() envoie UN SEUL appel a l'API Gemini TTS.
  Gemini identifie automatiquement les speakers ("Lea:", "Alex:") et
  applique la voix correspondante a chaque replique — c'est le mode
  "multi-speaker natif". La reponse est du PCM brut (s16le, 24000 Hz, mono).

        |
        v
[ETAPE 3] audio-converter.js
  ffmpeg convertit le PCM en MP3 128kbps (lisible par les navigateurs).
  Le fichier PCM intermediaire est supprime apres conversion.

        |
        v
MP3 final -> upload Supabase Storage -> URL stockee dans la DB
```

### Pourquoi Gemini TTS a la place de Google TTS ?

| Critere | Google TTS (supprime) | Gemini TTS (actuel) |
|---|---|---|
| Appels API par article | N appels (un par replique) | 1 seul appel |
| Multi-speaker | Simulation (concat N buffers) | Natif |
| Format de sortie | MP3 direct | PCM (converti par ffmpeg) |
| Authentification | Service Account JSON complexe | API Key simple |

L'ancien Google TTS faisait N appels sequentiels pour un dialogue de N repliques,
concatenait les buffers MP3 et produisait une audio sans transitions naturelles
entre les voix. Gemini TTS gere tout ca en un seul appel.

---

## Voix du podcast

| Personnage | Role | Voix Gemini |
|---|---|---|
| **Lea** | Animatrice principale, enthousiaste et optimiste | `Aoede` |
| **Alex** | Expert contextuel, pose et bienveillant | `Sadaltager` |

Les voix sont configurees dans `gemini-tts-client.js` via `DEFAULT_SPEAKER_VOICE_CONFIGS`.

---

## Categories d'articles

| Categorie | Domaine |
|---|---|
| `ecologie` | Environnement, climat, biodiversite |
| `social` | Education, communaute, droits |
| `tech` | IA, robotique, innovation numerique |
| `sante` | Medecine, bien-etre, sante mentale |
| `culture` | Art, musique, cinema, patrimoine |
| `science` | Astronomie, physique, decouvertes |

---

## Variables d'environnement

Copier `.env.example` vers `.env` :

```bash
cp .env.example .env
```

| Variable | Service | Usage |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) | Articles, scoring, categorisation, script dialogue |
| `GEMINI_API_KEY` | Google Gemini | Synthese vocale TTS |
| `GOOGLE_APPLICATION_CREDENTIALS` | Google Cloud | Generation images (Vertex AI / Imagen 3) |
| `GOOGLE_CLOUD_PROJECT_ID` | Google Cloud | ID du projet Vertex AI |
| `SUPABASE_URL` | Supabase | URL du projet |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Cle d'acces (role service) |

---

## Prerequis systeme

- **Node.js** >= 20
- **ffmpeg** installe et disponible dans le PATH

```bash
# Ubuntu / Debian
sudo apt-get install -y ffmpeg

# macOS
brew install ffmpeg
```

---

## Installation et lancement

```bash
# Installer les dependances
npm install

# Lancer la generation (production)
node src/index.js
```

---

## Scripts de test isoles

Ces scripts permettent de valider chaque etape du pipeline independamment.

### Tester la generation du script dialogue

```bash
node scripts/test-dialog-script.js
```

Genere et affiche un transcript dialogue Lea/Alex depuis un article de test.
Utilise pour valider le prompt Claude et le format de sortie avant de lancer le TTS.

### Tester la synthese vocale complete (TTS + conversion MP3)

```bash
node scripts/test-gemini-tts.js
```

Prend un transcript de test, appelle Gemini TTS, convertit en MP3 et
sauvegarde le resultat dans `./temp/test_dialog.mp3`.

**Prerequis** : `GEMINI_API_KEY` dans `.env` et `ffmpeg` installe.

---

## Deploiement — GitHub Actions

Le workflow `.github/workflows/daily-news.yml` se declenche :
- Automatiquement chaque nuit a **3h UTC** (4h heure francaise)
- Manuellement via le bouton "Run workflow" dans l'onglet Actions GitHub

### Secrets GitHub a configurer

Dans `Settings > Secrets and variables > Actions` du depot :

| Secret | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Cle API Anthropic |
| `GEMINI_API_KEY` | Cle API Google Gemini |
| `GOOGLE_CREDENTIALS_JSON` | Contenu JSON complet du fichier credentials Google Cloud |
| `SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Cle service role Supabase |

---

## Schema de la base de donnees Supabase

Table `articles` :

| Colonne | Type | Description |
|---|---|---|
| `id` | uuid | Identifiant unique |
| `published_date` | date | Date de publication (J+1 au moment de la generation) |
| `language` | text | Code langue (`fr`) |
| `title` | text | Titre de l'article genere |
| `summary` | text | Resume court (200 chars max, issu du RSS) |
| `content` | text | Contenu complet genere par Claude |
| `category` | text | Categorie de l'article |
| `source_url` | text | URL de la source RSS originale |
| `audio_url` | text | URL du MP3 dans Supabase Storage (null si echec) |
| `audio_format` | text | Format audio (`podcast`) |
| `image_url` | text | URL de l'image dans Supabase Storage (null si echec) |

---

## Stack technique

| Composant | Technologie |
|---|---|
| Runtime | Node.js 20 (ES Modules) |
| Generation texte | Anthropic Claude (Sonnet + Haiku) |
| Synthese vocale | Google Gemini TTS (`gemini-2.5-flash-preview-tts`) |
| Generation images | Google Imagen 3 (via Vertex AI) |
| Conversion audio | ffmpeg |
| Base de donnees | Supabase (PostgreSQL) |
| Stockage fichiers | Supabase Storage |
| CI/CD | GitHub Actions |
