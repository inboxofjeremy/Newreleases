import fs from "fs";
import path from "path";

// ===============================
// CONFIG
// ===============================
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const DAYS_BACK = 180;
const EARLIEST_PRIMARY_YEAR = 2024; // Blocks classic catalog re-releases (e.g. Mars Attacks!)
const MAX_PAGES_PER_CHUNK = 10;
const TMDB_CONCURRENCY = 8;

// ===============================
// DATE HELPERS
// ===============================
function getDateChunks(totalDaysBack = DAYS_BACK, chunkSizeDays = 30) {
  const chunks = [];
  let currentEnd = new Date();
  currentEnd.setDate(currentEnd.getDate() + 2); // Timezone padding

  const finalStart = new Date();
  finalStart.setDate(finalStart.getDate() - totalDaysBack);

  while (currentEnd > finalStart) {
    let currentStart = new Date(currentEnd);
    currentStart.setDate(currentStart.getDate() - chunkSizeDays);

    if (currentStart < finalStart) {
      currentStart = new Date(finalStart);
    }

    chunks.push({
      from: currentStart.toISOString().slice(0, 10),
      to: currentEnd.toISOString().slice(0, 10),
    });

    currentEnd = new Date(currentStart);
  }

  return chunks;
}

// ===============================
// FETCH HELPERS
// ===============================
async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function isAllowed(dateStr) {
  if (!dateStr) return false;

  const releaseTime = new Date(dateStr).getTime();
  const now = Date.now();

  const minTime = now - DAYS_BACK * 24 * 60 * 60 * 1000;
  const maxTime = now + 2 * 24 * 60 * 60 * 1000; // Past + next 2 days

  return releaseTime >= minTime && releaseTime <= maxTime;
}

// ===============================
// US/CA RELEASE DATE HELPER
// ===============================
async function fetchReleaseDate(id) {
  const json = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_API_KEY}`
  );

  if (!json?.results?.length) return null;

  const regions = json.results.filter(
    (r) => r.iso_3166_1 === "US" || r.iso_3166_1 === "CA"
  );
  if (!regions.length) return null;

  const candidateDates = [];

  for (const reg of regions) {
    if (!reg.release_dates) continue;
    for (const rd of reg.release_dates) {
      if (rd.release_date) {
        candidateDates.push({
          date: rd.release_date.slice(0, 10),
          type: rd.type,
        });
      }
    }
  }

  if (!candidateDates.length) return null;

  // 1. Digital (Type 4) inside 180-day window
  const validDigital = candidateDates
    .filter((d) => d.type === 4 && isAllowed(d.date))
    .map((d) => d.date)
    .sort();

  if (validDigital.length) return validDigital[0];

  // 2. Theatrical / Limited (Type 3 or 2) inside 180-day window
  const validTheatrical = candidateDates
    .filter((d) => (d.type === 3 || d.type === 2) && isAllowed(d.date))
    .map((d) => d.date)
    .sort();

  if (validTheatrical.length) return validTheatrical[0];

  // 3. Any valid regional date inside 180-day window
  const anyValid = candidateDates
    .filter((d) => isAllowed(d.date))
    .map((d) => d.date)
    .sort();

  if (anyValid.length) return anyValid[0];

  return null;
}

// ===============================
// CONCURRENCY
// ===============================
async function pMap(list, fn, concurrency = TMDB_CONCURRENCY) {
  const out = new Array(list.length);
  let i = 0;

  const workers = Array(concurrency)
    .fill(0)
    .map(async () => {
      while (true) {
        const idx = i++;
        if (idx >= list.length) break;
        try {
          out[idx] = await fn(list[idx], idx);
        } catch {
          out[idx] = null;
        }
      }
    });

  await Promise.all(workers);
  return out;
}

// ===============================
// FETCH MOVIES
// ===============================
async function fetchMovies() {
  const chunks = getDateChunks(DAYS_BACK, 30);
  const rawResultsMap = new Map();

  // Query both US and CA regions explicitly with with_release_type so TMDB evaluates regional dates
  const regions = ["US", "CA"];

  for (const region of regions) {
    for (const chunk of chunks) {
      for (let page = 1; page <= MAX_PAGES_PER_CHUNK; page++) {
        const url =
          `https://api.themoviedb.org/3/discover/movie?` +
          `api_key=${TMDB_API_KEY}` +
          `&language=en-US` +
          `&with_original_language=en` +
          `&region=${region}` +
          `&with_release_type=2|3|4` +
          `&sort_by=release_date.desc` +
          `&release_date.gte=${chunk.from}` +
          `&release_date.lte=${chunk.to}` +
          `&without_genres=27` +
          `&page=${page}`;

        const j = await fetchJSON(url);
        if (!j?.results?.length) break;

        for (const movie of j.results) {
          if (!rawResultsMap.has(movie.id)) {
            rawResultsMap.set(movie.id, movie);
          }
        }

        if (page >= j.total_pages) break;
      }
    }
  }

  const rawList = Array.from(rawResultsMap.values());

  const mapped = await pMap(rawList, async (m) => {
    if (!m?.id) return null;

    // RULE 1: Filter out old catalog films (e.g., Mars Attacks!)
    const primaryYear = m.release_date
      ? parseInt(m.release_date.slice(0, 4), 10)
      : 0;

    if (primaryYear < EARLIEST_PRIMARY_YEAR) {
      return null;
    }

    // RULE 2: Get precise US/CA date that falls inside the 180-day window
    const targetDate = await fetchReleaseDate(m.id);
    if (!targetDate) return null;

    return {
      id: `tmdb:${m.id}`,
      type: "movie",
      name: m.title || m.original_title || `Movie ${m.id}`,
      description: m.overview || "",
      poster: m.poster_path
        ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
        : null,

      releaseInfo: targetDate,
    };
  });

  const seen = new Set();
  const out = [];

  for (const item of mapped) {
    if (!item) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }

  // Newest first
  return out.sort((a, b) => {
    return new Date(b.releaseInfo) - new Date(a.releaseInfo);
  });
}

// ===============================
// META BUILDER
// ===============================
async function buildMeta(id, targetDate = null) {
  const tmdbId = id.startsWith("tmdb:") ? id.split(":")[1] : id;
  if (!tmdbId) return null;

  const movie = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`
  );

  if (!movie) return null;

  return {
    meta: {
      id: `tmdb:${movie.id}`,
      type: "movie",
      name: movie.title,
      description: movie.overview || "",
      poster: movie.poster_path
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : null,
      background: movie.backdrop_path
        ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
        : null,

      released:
        targetDate ||
        (movie.release_date ? movie.release_date.slice(0, 10) : null),

      imdb: movie.imdb_id || null,
    },
  };
}

// ===============================
// BUILD
// ===============================
async function build() {
  console.log("Fetching movies…");

  const movies = await fetchMovies();

  fs.mkdirSync("./catalog/movie", { recursive: true });
  fs.mkdirSync("./meta/movie", { recursive: true });

  fs.writeFileSync(
    "./catalog/movie/new_releases.json",
    JSON.stringify({ metas: movies }, null, 2)
  );

  for (const m of movies) {
    const meta = await buildMeta(m.id);
    if (!meta) continue;

    fs.writeFileSync(
      `./meta/movie/${m.id}.json`,
      JSON.stringify(meta, null, 2)
    );
  }

  console.log("Done.");
}

build();
