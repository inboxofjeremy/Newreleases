export default async function handler(req, res) {
  const url = req.url;

  // ------------------------------
  // ENV TEST
  // ------------------------------
  if (url.includes("/envtest")) {
    const key = process.env.TMDB_API_KEY || null;
    return res.json({
      TMDB_KEY_PRESENT: key ? true : false,
      TMDB_KEY_LENGTH: key ? key.length : 0
    });
  }

  // ------------------------------
  // MANIFEST
  // ------------------------------
  if (url.includes("/manifest.json")) {
    return res.json({
      id: "newreleases",
      version: "1.0.0",
      name: "New Releases Movies",
      description: "Movies released in last 90 days",
      logo: "https://www.stremio.com/website/static/favicon/android-icon-192x192.png",
      types: ["movie"],
      catalogs: [
        {
          type: "movie",
          id: "recent_movies",
          name: "Recent Movies",
          extra: [{ name: "skip", isRequired: false }],
        },
      ],
      resources: ["catalog", "meta"]
    });
  }

  // ------------------------------
  // CATALOG (MOVIES)
  // ------------------------------
  if (url.includes("/catalog/movie/recent_movies.json")) {
    const key = process.env.TMDB_API_KEY;
    if (!key) {
      return res.json({ metas: [], error: "TMDB key missing" });
    }

    const ninetyDaysAgo = new Date(Date.now() - 90*24*60*60*1000)
      .toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];

    const tmdbUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${key}&sort_by=release_date.desc&language=en-US&with_original_language=en&region=US&include_adult=false&release_date.gte=${ninetyDaysAgo}&release_date.lte=${today}`;

    const r = await fetch(tmdbUrl);
    const j = await r.json();

    const metas = (j.results || []).map(m => ({
      id: "tmdb:" + m.id,
      type: "movie",
      name: m.title,
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
      background: m.backdrop_path ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` : null,
      description: m.overview || "",
      releaseInfo: m.release_date || "",
    }));

    return res.json({ metas });
  }

  // fallback
  return res.status(404).json({ error: "Not found" });
}
