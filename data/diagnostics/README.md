# N13 / National Route 20 diagnostic

`build-n13-koshu-fixture.py` now starts with **every N13 feature in the study
area**, filters it to ordinary national roads (`N13_003 == "1"`), and only then
compares those features with OSM National Route 20. It does not use the former
100 m all-road corridor candidate file.

Run the reproducible diagnostic with:

```sh
python scripts/preprocess/build-n13-shinjuku-fixture.py
python scripts/preprocess/build-n13-koshu-fixture.py --refresh-osm
```

The second command writes:

* `public/data/diagnostics/n13-national-roads-route-20.geojson`: all shortlisted N13 features with
  minimum, median, and p90 sampled residuals attached;
* `public/data/diagnostics/n13-national-roads-route-20.csv`: the same per-feature diagnostic attributes;
* `public/data/diagnostics/n13-national-roads-route-20.report.json`: before/after counts and lengths,
  N13 attribute distributions, and residual percentiles; and
* `data/cache/osm-route-20.geojson`: the OSM reference ways, obtained by `ref=20`
  and membership of a `route=road`, `ref=20` relation rather than by an exact
  Japanese road name.

Distances are calculated in JGD2011 / Japan Plane Rectangular CS IX at both
endpoints and every 5 m along each original N13 geometry. No final cutoff is
assigned: the report's percentiles are intended to reveal (or refute) a separate
low-residual population before a production threshold is discussed. Each N13
feature remains independent, preserving divided carriageways; there is no COINS,
interpolation of output geometry, or synthetic centerline.

After generating the files, run `npm run dev` and open the site. The temporary
diagnostic panel reports 1,001 N13 national-road features when the generated file
has loaded. On the map, median residuals of 0–10 m are dark green, 10–20 m are
light green, 20–50 m are amber, and more distant national roads fade to gray.
This makes the candidate Route 20 chain visible while retaining every feature.

The source N13 study-area fixture and cached OSM download are intentionally
gitignored source data. Consequently generated diagnostic outputs should be
produced only from those authoritative inputs, not reconstructed from the old
100 m corridor fixture.
