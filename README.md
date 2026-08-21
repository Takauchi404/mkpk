# Prediksi MKPK

An independent credit-recognition prediction tool for MKPK activities, built around Universitas Hasanuddin's Rubrik MKPK Edisi 3. It exists to give students a reliable estimate before they submit an actual claim through Sipakamase.

The workflow: pick an activity you've completed, fill in the coefficients and achievements, and the tool works out the resulting credit. It then spreads that credit across eligible MKPK courses, filling whichever one needs the least first so more courses end up complete. Add more activities later, and it'll flag if reshuffling the existing ones would get you a better result.

A separate "Panduan Konversi Sipakamase" tab turns that prediction into manual steps for Sipakamase itself. Sipakamase doesn't allocate anything automatically — a course just soaks up credit until it's full, and the rest carries over to the next one. Since you can only pick one course at a time there, this tab tells you the order to pick them in so the outcome actually matches the prediction.

The application is static (`index.html`, `style.css`, `data.js`, `app.js`), with no backend or database involved. All data is stored locally in the browser (via localStorage), which means it does not persist across devices or browsers.

This is not an official university system. Actual MKPK claims must still be submitted through Sipakamase; this tool is only meant to support the estimation that precedes it.

## Running locally

Open `index.html` directly in a browser, or serve it locally:

```
python3 -m http.server 8000
```

## Deployment

The site is entirely static, so it can be deployed to any static host with no build command required, GitHub Pages, Cloudflare Workers (static assets), Netlify, Vercel, or similar. Connect the repository and deploy as-is.
