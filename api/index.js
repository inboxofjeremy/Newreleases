import fetch from "node-fetch";
import { addonBuilder } from "stremio-addon-sdk";

const TMDB_KEY = process.env.TMDB_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";

const builder = new addonBuilder({
  id: "recent_movies",
  version: "1.0.0",
  name: "Recent Movie Releases",
  catalogs: [
    {
      type: "movie",
      id: "recent_movies",
      name: "Recent Movie Releases (US/CA/GB)",
      extra: [],
    },
  ],
  resources: ["catalog", "meta"],
  types: ["movie"],
});

// -------------------------------
// Helper: Fetch JSON
// -------------------------------
async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json();
}

// -------------------------------
// Helper: US / CA / GB COUNTRY FILTER
// -------------------------------
function allowedCountry(movie) {
  const allowed = ["US", "CA", "GB"];

  // origin_country: ["US"]
  if (movie.origin_country && movie.origin_country.some(c => allowed.includes(c))) {
    return true;
  }

  // production_countries: [{ iso_3166_1: "US" }]
  if (
    movie.production_countries &&
    movie.production_countries.some(pc => allowed.includes(pc.iso_3166_1))
  ) {
    return true;
  }

  return false;
}

// -------------------------------
// Helper: Clean poster path
// -------------------------------
function poster(path) {
  return path ? `https://image.tmdb.org/t/p/w500${path}` : null;
}

// -------------------------------
// Fetch movies released in last 30 days
// -------------------------------
async function getRecentMovies() {
  const today = new Date();
  const past = new Date();
  past.setDate(today.getDate() - 30);

  const todayStr = today.toISOString().split("T")[0];
  const pastStr = past.toISOString().split("T")[0];

  const url = `${TMDB_BASE}/discover/movie?api_key=${TMDB_KEY}` +
    `&primary_release_date.gte=${pastStr}` +
    `&primary_release_date.lte=${todayStr}` +
    `&include_adult=false&language=en-US&sort_by=primary_release_date.desc`;

  let firstPage = await getJSON(url);
  if (!firstPage || !firstPage.results) return [];

  let results = [...firstPage.results];

  const totalPages = Math.min(firstPage.total_pages || 1, 3); // fetch up to 3 pages

  for (let page = 2; page <= totalPages; page++) {
    const p = await getJSON(url + `&page=${page}`);
    if (p && p.results) results.push(...p.results);
  }

  // Fetch full details for each movie to get production_countries
  const detailedMovies = [];
  for (let movie of results) {
    const full = await getJSON(
      `${TMDB_BASE}/movie/${movie.id}?api_key=${TMDB_KEY}&language=en-US`
    );
    if (!full) continue;

    // Apply country filter
    if (!allowedCountry(full)) continue;

    detailedMovies.push(full);
  }

  return detailedMovies;
}

// -------------------------------
// CATALOG HANDLER
// -------------------------------
builder.defineCatalogHandler(async () => {
  const movies = await getRecentMovies();

  const metas = movies.map(m => ({
    id: "tmdb:" + m.id,
    type: "movie",
    name: m.title,
    poster: poster(m.poster_path),
    background: poster(m.backdrop_path),
    description: m.overview || "",
    releaseDate: m.release_date,
  }));

  return { metas };
});

// -------------------------------
// META HANDLER
// -------------------------------
builder.defineMetaHandler(async ({ id }) => {
  const tmdbId = id.split(":")[1];

  const data = await getJSON(
    `${TMDB_BASE}/movie/${tmdbId}?api_key=${TMDB_KEY}&language=en-US&append_to_response=videos`
  );

  if (!data) return { meta: {} };

  return {
    meta: {
      id,
      type: "movie",
      name: data.title,
      description: data.overview,
      poster: poster(data.poster_path),
      background: poster(data.backdrop_path),
      releaseInfo: data.release_date,
      runtime: data.runtime ? `${data.runtime} min` : "Unknown",
      videos: (data.videos?.results || [])
        .filter(v => v.site === "YouTube")
        .map(v => ({
          id: v.id,
          title: v.name,
          thumbnail: `https://img.youtube.com/vi/${v.key}/0.jpg`,
          stream: `https://www.youtube.com/watch?v=${v.key}`,
        })),
    },
  };
});

// -------------------------------
// EXPORT
// -------------------------------
export default builder.getInterface();
