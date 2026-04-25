import fs from "fs";

// ===============================
// CONFIG
// ===============================
const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 180;
const MAX_PAGES = 20;
const TMDB_CONCURRENCY = 8;

// ===============================
// DATE RANGE
// ===============================
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

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

// ===============================
async function pMap(list, fn, concurrency = TMDB_CONCURRENCY) {
  const out = new Array(list.length);
  let i = 0;

  const workers = Array(concurrency).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= list.length) break;

      try {
        out[idx] = await fn(list[idx]);
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
  const all = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `https://api.themoviedb.org/3/discover/movie?` +
      `api_key=${TMDB_KEY}` +
      `&language=en-US` +
      `&with_original_language=en` +
      `&sort_by=primary_release_date.desc` +
      `&without_genres=27` +
      `&page=${page}`;

    const j = await fetchJSON(url);

    if (!j || !Array.isArray(j.results)) continue;

    all.push(...j.results);

    if (page >= j.total_pages) break;
  }

  const mapped = await pMap(all, async (m) => {
    if (!m?.id) return null;

    const releaseDate = m.release_date;
    if (!releaseDate) return null;

    // enforce your 180-day window safely
    if (releaseDate < DATE_FROM || releaseDate > DATE_TO) {
      return null;
    }

    const voteCount = m.vote_count || 0;
    const popularity = m.popularity || 0;

    // safe filter (prevents junk, keeps real releases)
    if (voteCount < 1 && popularity < 1) {
      return null;
    }

    return {
      id: `tmdb:${m.id}`,
      type: "movie",
      name: m.title || m.original_title || `Movie ${m.id}`,
      description: m.overview || "",
      poster: m.poster_path
        ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
        : null,
      releaseInfo: releaseDate,
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

  return out.sort(
    (a, b) => new Date(b.releaseInfo) - new Date(a.releaseInfo)
  );
}

// ===============================
// META BUILDER
// ===============================
async function buildMeta(id) {
  const tmdbId = id.split(":")[1];
  if (!tmdbId) return null;

  const movie = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`
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
      released: movie.release_date || null,
      imdb: movie.imdb_id || null,
    },
  };
}

// ===============================
// BUILD
// ===============================
async function build() {
  console.log("Fetching movies...");

  const movies = await fetchMovies();

  console.log("Final catalog size:", movies.length);

  fs.mkdirSync("./catalog/movie", { recursive: true });
  fs.mkdirSync("./meta/movie", { recursive: true });

  fs.writeFileSync(
    "./catalog/movie/new_releases.json",
    JSON.stringify({ metas: movies, ts: Date.now() }, null, 2)
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
