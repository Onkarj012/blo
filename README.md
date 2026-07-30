# blo_photo

OCR extraction plus a mobile-first voter finder PWA. The Python pipeline reads PNGs from
`data/input`, extracts cleaned voter CSVs into `data/output`, and the Next.js app turns
those cleaned CSVs into a phone-friendly nearby voter workflow backed by SQLite.

## Project Structure

```text
blo_photo/
├── data/
│   ├── input/
│   ├── output/
│   ├── logs/
│   └── app/              # generated SQLite database
├── public/
├── src/
│   ├── app/
│   ├── components/
│   └── lib/
├── scripts/
│   ├── extract_profiles.py
│   ├── run_full_export.py
│   └── import-cleaned-csv.ts
├── package.json
├── bun.lock
├── requirements.txt
└── README.md
```

## Setup

Install the web app dependencies:

```bash
bun install
```

Install Python dependencies:

```bash
python3 -m pip install -r requirements.txt
```

Install Tesseract if it is not already available:

```bash
brew install tesseract
```

## Run The PWA

Start the mobile web app:

```bash
bun run dev
```

Seed the app database from the combined cleaned CSV:

```bash
bun run import:csv
```

By default this imports `data/output/clean/1_1530_cleaned.csv` into
`data/app/voters.sqlite`.

Admin upload flow:

- Open `/upload`
- Upload a cleaned CSV with the existing cleaned schema
- The app upserts voters, preserves field status, and refreshes the SQLite store

To sync Part 355's pending serial-number list into the existing Pending/Done
filter and cluster counts, generate the status-enriched CSV:

```bash
python3 scripts/add_part_status.py \
  --pending-file /path/to/Part_355_All_Serial_Numbers.txt
```

Then upload `data/output/merged/ecinet_1_1530_part_355_status.csv` from `/upload`.
Rows with serial numbers in the supplied list are imported as `pending`; all
other Part 355 rows are imported as `done`.

For subsequent updates, use the **Update pending list — Part 355** form on
`/upload`. Paste the current pending Part Serial Nos. as comma-separated
numbers and submit. The app updates Convex directly, so the existing Pending,
Done, and cluster filters and all exports reflect the new statuses.

The generated CSV includes `part_no`, `part_serial_no`, and `status`. The app's
default CSV/PDF exports also include Part No. and Part Serial No.

Field flow:

- Open `/` on the phone
- Allow location access
- Filter between `Pending only`, `All`, `Done`, and `Revisit`
- Use `Call`, `Navigate`, `Mark status`, and `Pin today`

Notes:

- This v1 app is private-use only and intentionally has no login layer.
- Geocoding is cluster-based and approximate, tuned for the Pimple Saudagar dataset.

## Run The OCR Pipeline

Process all folders under `data/input`:

```bash
python3 scripts/extract_profiles.py
```

Process a single folder:

```bash
python3 scripts/extract_profiles.py --folder 1_100
```

Process a folder and split raw vs cleaned CSVs into separate directories:

```bash
python3 scripts/extract_profiles.py \
  --folder 301_400 \
  --raw-output-dir data/output/raw \
  --cleaned-output-dir data/output/cleaned
```

Rebuild all folder-level exports and also create grouped cleaned CSVs in
`data/output/clean` plus one combined cleaned file:

```bash
python3 scripts/run_full_export.py
```

## Verify

Run automated checks:

```bash
bun run test
bun run lint
bun run build
```

## Output

Each image becomes one row in the detailed CSV with these columns:

- `source_image`
- `applicant_name`
- `epic_number`
- `gender`
- `age`
- `relative_name`
- `relative_type`
- `mobile_number`
- `address`
- `assembly_constituency`
- `district`
- `raw_ocr_text`
- `parse_status`

Generated files:

- Detailed CSVs are written as `data/output/<folder>.csv` by default, or to `--raw-output-dir/<folder>.csv`
- Cleaned CSVs are written as `data/output/<folder>_cleaned.csv` by default, or to `--cleaned-output-dir/<folder>_cleaned.csv`
- Grouped cleaned CSVs are written to `data/output/clean/<range>_cleaned.csv` when using `scripts/run_full_export.py`
- The combined cleaned CSV is written to `data/output/clean/1_<max>_cleaned.csv` when using `scripts/run_full_export.py`
- Run logs are written to `data/logs/`

The cleaned CSV keeps only the essential columns:

- `name`
- `phone_number`
- `address`
- `age`
- `gender`
- `relative_name`
- `relative_type`
- `epic_number`
- `assembly_constituency`
- `district`

`parse_status` is:

- `ok` when the core fields were extracted cleanly
- `partial` when OCR succeeded but some fields are missing
- `ocr_failed` when the image could not be processed
