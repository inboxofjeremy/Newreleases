import fs from "fs";

// ===============================
// CONFIG
// ===============================
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const DAYS_BACK = 180;
const EARLIEST_PRIMARY_YEAR = 2024;
const MAX_PAGES_PER_CHUNK = 10;
const TMDB_CONCURRENCY = 8;
const MIN_VOTE_COUNT = 3;

// ===============================
// DATE HELPERS
// ===============================
function getDateChunks(totalDaysBack = DAYS_BACK, chunkSizeDays = 30) {
  const chunks = [];
  let currentEnd = new Date();
  currentEnd.setDate(currentEnd.getDate() + 2);

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
  const maxTime = now + 2 * 24 * 60 * 60 * 1000;
  return releaseTime >= minTime && releaseTime <= maxTime;
}

async function fetchUSReleaseDate(id) {
  const json = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_API_KEY}`
  );

  if (!json?.results?.length) return null;

  const us = json.results.find((r) => r.iso_3166_1 === "US");
  if (!us?.release_dates?.length) return null;

  const digitalDates = us.release_dates
    .filter((d) => d.type === 4 && d.release_date)
    .map((d) => d.release_date.slice(0, 10))
    .sort();

  if (digitalDates.length) return digitalDates[0];

  const allUsDates = us.release_dates
    .filter((d) => d.release_date)
    .map((d) => d.release_date.slice(0, 10))
    .sort();

  if (!allUsDates.length) return null;
  return allUsDates[allUsDates.length - 1];
}

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

async function fetchMovies() {
  const chunks = getDateChunks(DAYS_BACK, 30);
  const rawResultsMap = new Map();

  for (const chunk of chunks) {
    for (let page = 1; page <= MAX_PAGES_PER_CHUNK; page++) {
      const url =
        `https://api.themoviedb.org/3/discover/movie?` +
        `api_key=${TMDB_API_KEY}` +
        `&language=en-US` +
        `&with_original_language=en` +
        `&region=US` +
        `&with_release_type=4|3` +
        `&vote_count.gte=${MIN_VOTE_COUNT}` +
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

  const rawList = Array.from(rawResultsMap.values());

  const mapped = await pMap(rawList, async (m) => {
    if (!m?.id) return null;

    const primaryYear = m.release_date
      ? parseInt(m.release_date.slice(0, 4), 10)
      : 0;

    if (primaryYear < EARLIEST_PRIMARY_YEAR) return null;

    const usDate = await fetchUSReleaseDate(m.id);
    if (!usDate) return null;
    if (!isAllowed(usDate)) return null;

    return {
      id: `tmdb:${m.id}`,
      type: "movie",
      name: m.title || m.original_title || `Movie ${m.id}`,
      description: m.overview || "",
      poster: m.poster_path
        ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
        : null,
      releaseInfo: usDate,
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

  return out.sort((a, b) => new Date(b.releaseInfo) - new Date(a.releaseInfo));
}

async function build() {
  console.log("Fetching movies…");
  const movies = await fetchMovies();

  fs.mkdirSync("./catalog/movie", { recursive: true });

  fs.writeFileSync(
    "./catalog/movie/new_releases.json",
    JSON.stringify({ metas: movies }, null, 2)
  );

  console.log("Done.");
}

build();
