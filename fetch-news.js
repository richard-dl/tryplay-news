const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  },
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['enclosure', 'enclosure'],
      ['content:encoded', 'contentEncoded']
    ]
  }
});

// ── RSS feeds (same sources as the Render service) ──────────────────────
const RSS_FEEDS = [
  { name: 'Clarín', url: 'https://www.clarin.com/rss/lo-ultimo/' },
  { name: 'La Nación', url: 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/' },
  { name: 'Infobae', url: 'https://www.infobae.com/arc/outboundfeeds/rss/' },
  { name: 'Perfil', url: 'https://www.perfil.com/feed' },
  { name: 'Ámbito', url: 'https://www.ambito.com/rss/pages/home.xml' },
  { name: 'Olé', url: 'https://www.ole.com.ar/rss/' },
  { name: 'TyC Sports', url: 'https://www.tycsports.com/rss.xml' },
  { name: 'BBC Mundo', url: 'https://feeds.bbci.co.uk/mundo/rss.xml' },
];

const MAX_NEWS = 10;
const MAX_HOURS_AGO = 12;

// ── Emoji generator (keyword-based, same as original) ───────────────────
const EMOJI_MAP = [
  { keywords: ['fútbol', 'gol', 'mundial', 'messi', 'selección', 'libertadores', 'copa', 'boca', 'river'], emoji: '⚽' },
  { keywords: ['tenis', 'atp', 'wta', 'slam'], emoji: '🎾' },
  { keywords: ['basket', 'nba', 'básquet'], emoji: '🏀' },
  { keywords: ['f1', 'fórmula', 'ferrari', 'colapinto'], emoji: '🏎️' },
  { keywords: ['deporte', 'olímpic', 'medalla', 'atleta'], emoji: '🏅' },
  { keywords: ['dólar', 'peso', 'cotización', 'banco', 'financ', 'inflación', 'bcra'], emoji: '💵' },
  { keywords: ['economía', 'pbi', 'crecimiento', 'recesión', 'mercado'], emoji: '📊' },
  { keywords: ['milei', 'presidente', 'gobierno', 'congreso', 'senado', 'diputado'], emoji: '🏛️' },
  { keywords: ['elecciones', 'voto', 'candidat', 'campaña'], emoji: '🗳️' },
  { keywords: ['justicia', 'juez', 'tribunal', 'fiscal', 'juicio'], emoji: '⚖️' },
  { keywords: ['crimen', 'policial', 'asesinato', 'robo', 'detenid'], emoji: '🚨' },
  { keywords: ['tecnología', 'ia', 'inteligencia artificial', 'app', 'digital', 'cyber'], emoji: '💻' },
  { keywords: ['celular', 'iphone', 'android', 'samsung', 'apple'], emoji: '📱' },
  { keywords: ['cine', 'película', 'oscar', 'hollywood', 'netflix', 'serie'], emoji: '🎬' },
  { keywords: ['música', 'cantante', 'recital', 'concierto', 'show'], emoji: '🎵' },
  { keywords: ['clima', 'tormenta', 'lluvia', 'temperatura', 'calor', 'frío'], emoji: '🌤️' },
  { keywords: ['terremoto', 'sismo', 'volcán', 'inundación'], emoji: '🌊' },
  { keywords: ['salud', 'hospital', 'médic', 'vacuna', 'virus', 'enfermedad'], emoji: '🏥' },
  { keywords: ['educación', 'universidad', 'escuela', 'docente', 'estudiante'], emoji: '📚' },
  { keywords: ['guerra', 'conflicto', 'ataque', 'militar', 'ucrania', 'gaza', 'israel'], emoji: '💥' },
  { keywords: ['accidente', 'choque', 'vial', 'muert'], emoji: '🚗' },
  { keywords: ['trump', 'estados unidos', 'eeuu', 'biden', 'washington'], emoji: '🇺🇸' },
  { keywords: ['china', 'beijing', 'xi jinping'], emoji: '🇨🇳' },
  { keywords: ['brasil', 'lula', 'bolsonaro'], emoji: '🇧🇷' },
];

function generateEmojis(title, description) {
  const text = `${title} ${description || ''}`.toLowerCase();
  const emojis = new Set();
  for (const { keywords, emoji } of EMOJI_MAP) {
    if (keywords.some(kw => text.includes(kw))) {
      emojis.add(emoji);
      if (emojis.size >= 3) break;
    }
  }
  if (emojis.size === 0) emojis.add('📰');
  return [...emojis].join(' ');
}

// ── Image extraction ────────────────────────────────────────────────────
function extractImage(item) {
  if (item.mediaContent && item.mediaContent.$ && item.mediaContent.$.url) {
    return item.mediaContent.$.url;
  }
  if (item.mediaThumbnail && item.mediaThumbnail.$ && item.mediaThumbnail.$.url) {
    return item.mediaThumbnail.$.url;
  }
  if (item.enclosure && item.enclosure.url && item.enclosure.type && item.enclosure.type.startsWith('image')) {
    return item.enclosure.url;
  }
  // Try og:image from content
  const content = item.contentEncoded || item.content || '';
  const imgMatch = content.match(/<img[^>]+src="([^"]+)"/);
  if (imgMatch) return imgMatch[1];
  return null;
}

// ── Main ────────────────────────────────────────────────────────────────
async function fetchAllNews() {
  const cutoff = Date.now() - MAX_HOURS_AGO * 60 * 60 * 1000;
  const allItems = [];

  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      try {
        // Hard timeout: abort if feed takes >20s (some feeds hang beyond rss-parser timeout)
        const result = await Promise.race([
          parser.parseURL(feed.url),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Hard timeout 20s')), 20000)),
        ]);
        return (result.items || []).map(item => ({
          ...item,
          _source: feed.name,
        }));
      } catch (err) {
        console.error(`[SKIP] ${feed.name}: ${err.message}`);
        return [];
      }
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allItems.push(...result.value);
    }
  }

  // Filter by date
  const recent = allItems.filter(item => {
    const pubDate = item.pubDate || item.isoDate;
    if (!pubDate) return false;
    return new Date(pubDate).getTime() > cutoff;
  });

  // Sort newest first
  recent.sort((a, b) => {
    const da = new Date(a.pubDate || a.isoDate).getTime();
    const db = new Date(b.pubDate || b.isoDate).getTime();
    return db - da;
  });

  // Deduplicate by title (first 50 chars)
  const seen = new Set();
  const unique = recent.filter(item => {
    const key = item.title.toLowerCase().substring(0, 50).replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Diversify sources: max 2 per source
  const sourceCounts = {};
  const diversified = unique.filter(item => {
    const count = sourceCounts[item._source] || 0;
    if (count >= 2) return false;
    sourceCounts[item._source] = count + 1;
    return true;
  });

  // Take top N
  const top = diversified.slice(0, MAX_NEWS);

  // Format output
  return top.map(item => {
    const description = (item.contentSnippet || item.content || item.summary || '')
      .replace(/<[^>]+>/g, '')
      .substring(0, 300)
      .trim();

    return {
      title: item.title || '',
      description,
      source: item._source || '',
      link: item.link || '',
      image: extractImage(item),
      pubDate: item.isoDate || item.pubDate || new Date().toISOString(),
      emojisString: generateEmojis(item.title, description),
    };
  });
}

async function main() {
  console.log(`[${new Date().toISOString()}] Fetching news...`);
  const news = await fetchAllNews();
  console.log(`Got ${news.length} articles from ${[...new Set(news.map(n => n.source))].join(', ')}`);

  const output = {
    success: true,
    data: news,
    count: news.length,
    updated: new Date().toISOString(),
  };

  const outPath = path.join(__dirname, 'news.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Written to ${outPath}`);
}

main().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
