export const config = { runtime: "edge" };

const manifest = {
  id: "recent_movies",
  version: "1.0.0",
  name: "Recent Movie Releases",
  description: "Hollywood movies released in the last 90 days",
  catalogs: [
    {
      id: "recent_movies",
      type: "movie",
      name: "Recent Releases",
      extra: [{ name: "skip", isRequired: false }]
    }
  ],
  resources: ["catalog"],
  types: ["movie"]
};

export default async function handler(req) {
  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
