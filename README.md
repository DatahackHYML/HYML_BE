# HYML_BE

## Argovis proxy

Set these environment variables on Railway or in your local `.env`:

```env
ARGOVIS_API_KEY=your_argovis_key
ARGOVIS_BASE_URL=https://argovis-api.colorado.edu
```

The backend now exposes:

```text
GET /api/argovis/profiles
GET /argovis/profiles
```

It forwards query parameters to Argovis and attaches the API key on the server.

Example frontend call:

```js
const params = new URLSearchParams({
  startDate: "2020-01-01T00:00:00Z",
  endDate: "2020-01-15T23:59:59Z",
  polygon: "[[-130,20],[-110,20],[-110,40],[-130,40],[-130,20]]",
  data: "pres,temp",
});

const res = await fetch(`${BACKEND_URL}/api/argovis/profiles?${params.toString()}`);
const profiles = await res.json();
```
