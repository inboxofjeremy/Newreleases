export const config = { runtime: "edge" };

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 90;
const REGIONS = ["US", "CA", "GB"];
const HOLLYWOOD_TYPES = [2, 3, 4, 6];

// ---- Utils ----
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

// ---- Fetch regional release date ----
async function fetchRegionalDate(id) {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`
    );
    const json = await res.json();
    if (!json.results) return null;

    for (const region of REGIONS) {
      const entry = json.results.find(r => r.iso_3166_1 === region);
      if (!entry) continue;

      const filtered = entry.release_dates
        .filter(r => HOLLYWOOD_TYPES.includes(r.type))
        .sort(
          (a, b) => new Date(a.release_date) - new Date(b.release_date)
        );

      if (filtered.length > 0) {
        return filtered[0].release_date.split("T")[0];
      }
    }
  } catch (err) {}

  return null;
}

// ---- Fetch Movies ----
async function fetchMovies() {
  const discoverUrl =
    `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}` +
    `&language=en-US` +
    `&with_original_language=en` +
    `&sort_by=release_date.desc` +
    `&release_date.gte=${DATE_FROM}` +
    `&release_date.lte=${DATE_TO}`;

  const res = await fetch(discoverUrl);
  const data = await res.json();
  if (!data.results) return [];

  const results = await Promise.all(
    data.results.map(async m => {
      const release = await fetchRegionalDate(m.id);
      if (!release) return null;
      if (release < DATE_FROM || release > DATE_TO) return null;

      return {
        id: m.id.toString(),
        type: "movie",
        name: m.title,
        poster: m.poster_path
          ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
          : null,
        description: m.overview || "",
        releaseInfo: release
      };
    })
  );

  return results.filter(Boolean);
}

// ---- Handler ----
export default async function handler() {
  try {
    const results = await fetchMovies();

    return new Response(
      JSON.stringify({ metas: results }, null, 2),
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ metas: [], error: err.message }),
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        }
      }
    );
  }
}
