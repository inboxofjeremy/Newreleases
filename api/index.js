const TMDB_KEY = process.env.TMDB_KEY || "YOUR_TMDB_KEY_HERE"; 
const REGIONS = ["US", "CA", "GB"];
const DAYS = 90;

export default async function handler(req, res) {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;

        // -------- MANIFEST --------
        if (pathname === "/manifest.json") {
            return res.status(200).json({
                id: "hollywood-new-releases",
                version: "1.0.0",
                name: "Hollywood New Releases",
                description: "Movies released theatrically or digitally in the last 90 days",
                types: ["movie"],
                catalogs: [
                    {
                        type: "movie",
                        id: "recent_movies",
                        name: "New Releases"
                    }
                ]
            });
        }

        // -------- CATALOG --------
        if (pathname === "/catalog/movie/recent_movies.json") {
            if (!TMDB_KEY || TMDB_KEY === "YOUR_TMDB_KEY_HERE") {
                return res.status(200).json({
                    metas: [],
                    error: "TMDB key missing"
                });
            }

            const today = new Date();
            const cutoff = new Date();
            cutoff.setDate(today.getDate() - DAYS);

            const discoverURL =
                `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}` +
                `&language=en-US&include_adult=false&sort_by=popularity.desc&with_release_type=3|2|4`;

            const discoverRes = await fetch(discoverURL);
            const discoverData = await discoverRes.json();

            if (!discoverData.results)
                return res.status(200).json({ metas: [], error: "Invalid TMDB response" });

            let movies = [];

            for (const movie of discoverData.results) {
                const rdURL =
                    `https://api.themoviedb.org/3/movie/${movie.id}/release_dates?api_key=${TMDB_KEY}`;
                const rdRes = await fetch(rdURL);
                const rdData = await rdRes.json();

                if (!rdData.results) continue;

                let pickedDate = null;

                // multi-region priority
                for (const region of REGIONS) {
                    const r = rdData.results.find(x => x.iso_3166_1 === region);
                    if (!r) continue;

                    const good = r.release_dates.find(
                        d => [2, 3, 4].includes(d.type) && d.release_date
                    );
                    if (good) {
                        pickedDate = good.release_date;
                        break;
                    }
                }

                if (!pickedDate) continue;

                const rd = new Date(pickedDate);
                if (rd < cutoff) continue;

                movies.push({
                    id: `tmdb:${movie.id}`,
                    type: "movie",
                    name: movie.title,
                    poster: movie.poster_path
                        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
                        : null,
                    background: movie.backdrop_path
                        ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
                        : null,
                    releaseInfo: pickedDate.slice(0, 10),
                    popularity: movie.popularity
                });
            }

            movies.sort((a, b) => new Date(b.releaseInfo) - new Date(a.releaseInfo));

            return res.status(200).json({ metas: movies });
        }

        // -------- 404 --------
        return res.status(404).json({ error: "Not found" });

    } catch (err) {
        return res.status(500).json({
            error: "Server error",
            details: err.message
        });
    }
}
