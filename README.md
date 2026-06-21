# SensorCity Archive

Small TypeScript project that builds a long-lived JSON archive for Karlsruhe
SensorCity sensors.

The hourly job reads the live SensorCity layer and appends the primary reading
for every known sensor category:

- `Temperatur`: `temp`
- `TSK-Container`: `fillinglvl_percent`
- `Regenschreiber`: `clicks`
- `Boden-Sensor`: `bodenfeuchte`
- `Wasserpegel-Sensor`: `pegel`

Each run records the current live reading for every sensor. The long-term
archive for every category is built entirely from these hourly live snapshots
committed by this project.

## Usage

```bash
npm install
npm run archive
```

Archives are written to `data/sensors/<category>/<device-id>.json`, with an
index at `data/registry.json` and the last run summary at `data/latest-run.json`.

To include every configured field instead of only each category's primary field:

```bash
npm run archive:all
```

## GitHub Actions

`.github/workflows/archive.yml` runs once an hour and commits changes under
`data/` back to the repository. After creating the GitHub repository, push this
project and enable Actions.
