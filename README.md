# NOAA CO2 Forecast Website

This project is now a shareable static website. Anyone can use it in a normal web browser once these files are uploaded to a static web host.

## Website files

- `index.html`: main page
- `app.js`: NOAA download, parsing, Holt-Winters forecast, and prediction interval logic
- `styles.css`: site styling
- `favicon.svg`: browser tab icon
- `site.webmanifest`: installable web app metadata
- `robots.txt`: crawler allow rule
- `404.html`: simple fallback page
- `.nojekyll`: keeps GitHub Pages from applying Jekyll processing

## Local preview

From this folder, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

Then open [http://localhost:8000](http://localhost:8000).

## Share on the web

### GitHub Pages

1. Create a GitHub repository and upload all files in this folder.
2. In the repository settings, open `Pages`.
3. Set the publishing source to the repository root on your main branch.
4. Save, wait for GitHub Pages to publish, and share the generated URL.

### Netlify Drop

1. Go to [https://app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag this whole folder into the page.
3. Netlify will publish it and give you a shareable URL.

### Any static host

Upload the files as-is to any host that can serve plain HTML, CSS, JS, SVG, JSON, and text files.

## Data source

- NOAA monthly mean CO2 file: <https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt>
- NOAA trends page referenced in the request: <https://gml.noaa.gov/ccgg/trends/graph.html>
