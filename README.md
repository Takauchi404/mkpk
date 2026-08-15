# Prediksi MKPK

An independent credit-recognition prediction tool for MKPK activities, built around Universitas Hasanuddin's Rubrik MKPK Edisi 3. It exists to give students a reliable estimate before they submit an actual claim through Sipakamase.

The workflow is straightforward: select an activity you've completed, enter the relevant coefficients and achievements, and the tool calculates the resulting credit and distributes it across eligible MKPK courses, prioritising whichever course has the smallest remaining requirement so that more courses reach completion overall. As new activities are added, the tool also checks whether a better distribution across previously saved activities has become possible, and surfaces that as a suggestion.

The entire application runs as a single HTML file, with no backend or database involved. All data is stored locally in the browser (via localStorage), which means it does not persist across devices or browsers.

This is not an official university system. Actual MKPK claims must still be submitted through Sipakamase; this tool is only meant to support the estimation that precedes it.

## Running locally

Open `index.html` directly in a browser, or serve it locally:

```
python3 -m http.server 8000
```

## Deployment

The repository can be connected directly to Cloudflare Pages with no build command required, as the site is entirely static.
