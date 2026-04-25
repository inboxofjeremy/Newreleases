import fs from "fs";

// ===============================
// CONFIG
// ===============================
const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const MAX_PAGES = 15;
const DAYS_BACK = 180;

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

    if (!j?.results?.length) continue;

    all.push(...j.results);

    if (page >= j.total_pages) break;
  }

  const filtered = all
    .filter((m) => m?.id && m.release_date)
    .map((m) => {
      const date = m.release_date;

      if (date < DATE_FROM || date > DATE_TO) return null;

      return {
        id: `tmdb:${m.id}`,
        type: "movie",
        name: m.title || m.original_title,
        description: m.overview || "",
        poster: m.poster_path
          ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
          : null,
        releaseInfo: date,
      };
    })
    .filter(Boolean);

  const seen = new Set();
  const out = [];

  for (const m of filtered) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }

  return out.sort(
    (a, b) => new Date(b.releaseInfo) - new Date(a.releaseInfo)
  );
}

// ===============================
async function buildMeta(id) {
  const tmdbId = id.split(":")[1];

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
async function build() {
  console.log("Fetching movies...");

  const movies = await fetchMovies();

  console.log("Total movies:", movies.length);

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
