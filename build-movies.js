// build-movies.js
// Run with Node 20 (package.json should include "type": "module")
import fs from "fs";
import path from "path";

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc"; // replace if needed
const DAYS_BACK = 180;
const MAX_PAGES = 20;
const TMDB_CONCURRENCY = 8;
const MIN_VOTE_COUNT = 5;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

async function fetchJSON(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      console.error("fetch failed", url, r.status);
      return null;
    }
    return await r.json();
  } catch (err) {
    console.error("fetch error", url, err && err.message);
    return null;
  }
}

async function fetchUSReleaseDate(id) {
  const json = await fetchJSON(`https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`);
  if (!json?.results) return null;
  const us = json.results.find(r => r.iso_3166_1 === "US");
  if (!us?.release_dates?.length) return null;
  // earliest US date
  const dates = us.release_dates.map(d => d.release_date?.slice(0,10)).filter(Boolean).sort();
  return dates[0] || null;
}

async function pMap(list, fn, concurrency = TMDB_CONCURRENCY) {
  const out = new Array(list.length);
  let i = 0;
  const workers = Array(Math.max(1, concurrency)).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= list.length) break;
      try { out[idx] = await fn(list[idx], idx); } catch (e) { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchMovies() {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `https://api.themoviedb.org/3/discover/movie?` +
      `api_key=${TMDB_KEY}` +
      `&language=en-US` +
      `&with_original_language=en` +
      `&region=US` +
      `&vote_count.gte=${MIN_VOTE_COUNT}` +
      `&sort_by=primary_release_date.desc` +
      `&primary_release_date.gte=${DATE_FROM}` +
      `&primary_release_date.lte=${DATE_TO}` +
      `&page=${page}`;

    const j = await fetchJSON(url);
    if (!j?.results?.length) break;
    all.push(...j.results);
    if (page >= j.total_pages) break;
  }

  const mapped = await pMap(all, async (m) => {
    if (!m?.id) return null;
    const usDate = await fetchUSReleaseDate(m.id);
    if (!usDate) return null;
    if (usDate < DATE_FROM || usDate > DATE_TO) return null;
    return {
      id: `tmdb:${m.id}`,
      type: "movie",
      name: m.title || m.original_title || `Movie ${m.id}`,
      description: m.overview || "",
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
      background: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : null,
      releaseInfo: usDate,
      tmdb_raw: m // small convenience; will remove before writing catalog if desired
    };
  });

  // dedupe
  const seen = new Set();
  const out = [];
  for (const item of mapped) {
    if (!item) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

async function writeFiles(movies) {
  // ensure directories
  fs.mkdirSync(path.join("catalog","movie"), { recursive: true });
  fs.mkdirSync(path.join("meta","movie"), { recursive: true });

  // write catalog
  const catalogPath = path.join("catalog","movie","recent_movies.json");
  // strip tmdb_raw before writing catalog
  const metas = movies.map(m => {
    const copy = {
      id: m.id,
      type: "movie",
      name: m.name,
      description: m.description,
      poster: m.poster,
      background: m.background,
      releaseInfo: m.releaseInfo
    };
    return copy;
  });
  fs.writeFileSync(catalogPath, JSON.stringify({ metas }, null, 2));
  console.log("Wrote catalog:", catalogPath, metas.length);

  // write per-movie meta files
  for (const m of movies) {
    const tmdbId = m.id.startsWith("tmdb:") ? m.id.split(":")[1] : m.id;
    // fetch full movie details for meta
    const movie = await fetchJSON(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`);
    const meta = {
      meta: {
        id: `tmdb:${movie?.id || tmdbId}`,
        type: "movie",
        name: movie?.title || m.name,
        description: movie?.overview || m.description,
        poster: movie?.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : m.poster,
        background: movie?.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : m.background,
        released: movie?.release_date || m.releaseInfo || null,
        imdb: movie?.imdb_id || null
      }
    };
    const filename = path.join("meta","movie", `tmdb:${tmdbId}.json`);
    fs.writeFileSync(filename, JSON.stringify(meta, null, 2));
  }
  console.log("Wrote meta files:", movies.length);
}

async function main() {
  console.log("Starting movie build", DATE_FROM, "->", DATE_TO);
  const movies = await fetchMovies();
  console.log("Candidates:", movies.length);
  await writeFiles(movies);
  console.log("Done.");
}

// run
main().catch(err => {
  console.error("Build failed:", err && (err.stack || err));
  process.exit(1);
});
