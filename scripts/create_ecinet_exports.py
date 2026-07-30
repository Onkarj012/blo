#!/usr/bin/env python3

"""Create a lossless ECINET merge and exact category/anomaly exports.

The original merge is old-CSV driven, so it can omit ECINET-only rows and
repeat one ECINET row when the cleaned CSV contains duplicate voters. This
script uses the raw ECINET rows as the authoritative one-row-per-record set,
attaches at most one cleaned voter row to each, and appends any leftover
cleaned rows at the end so neither source is silently discarded.
"""

from __future__ import annotations

import argparse
import csv
from collections import Counter, defaultdict
from pathlib import Path

try:
    from scripts.merge_ecinet_csv import (
        OUTPUT_COLUMNS,
        clean_text,
        fallback_key,
        merge_row,
        normalize_epic,
        read_rows,
    )
except ModuleNotFoundError:
    from merge_ecinet_csv import (
        OUTPUT_COLUMNS,
        clean_text,
        fallback_key,
        merge_row,
        normalize_epic,
        read_rows,
    )


DEFAULT_OLD_CSV = Path("data/output/clean_improved/1_1530_cleaned.csv")
DEFAULT_ECINET_CSV = Path("data/ecinet_pre_sir_mapping_S13_205_355_1500_rows.csv")
DEFAULT_OUTPUT_DIR = Path("data/output/merged")
DEFAULT_MERGED_NAME = "ecinet_1_1530_lossless_merged.csv"
SIMPLE_COLUMNS = ["Part Sr. No.", "Name", "Phone No.", "Address", "Epic No."]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a lossless ECINET merge and exact category exports."
    )
    parser.add_argument("--old-csv", type=Path, default=DEFAULT_OLD_CSV)
    parser.add_argument("--ecinet-csv", type=Path, default=DEFAULT_ECINET_CSV)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args()


def unique_index(rows: list[dict[str, str]], key_fn) -> dict[str, dict[str, str]]:
    grouped: defaultdict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        key = key_fn(row)
        if key:
            grouped[key].append(row)
    return {key: values[0] for key, values in grouped.items() if len(values) == 1}


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def simplify_row(row: dict[str, str]) -> dict[str, str]:
    return {
        "Part Sr. No.": clean_text(row.get("ecinet_part_sr_no")),
        "Name": clean_text(row.get("name")) or clean_text(row.get("ecinet_name")),
        "Phone No.": clean_text(row.get("phone_number")),
        "Address": clean_text(row.get("address")),
        "Epic No.": clean_text(row.get("epic_number")),
    }


def write_simple_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=SIMPLE_COLUMNS)
        writer.writeheader()
        writer.writerows(simplify_row(row) for row in rows)


def category(row: dict[str, str]) -> str:
    return clean_text(row.get("ecinet_mapping_category")).upper()


def is_anomaly(row: dict[str, str]) -> bool:
    discrepancy = clean_text(row.get("ecinet_discrepancy_flag")).upper()
    return discrepancy == "Y" or bool(clean_text(row.get("ecinet_remark")))


def main() -> None:
    args = parse_args()
    old_rows = read_rows(args.old_csv)
    ecinet_rows = read_rows(args.ecinet_csv)

    by_epic = unique_index(ecinet_rows, lambda row: normalize_epic(row.get("epic_number")))
    by_name_relative = unique_index(
        ecinet_rows,
        lambda row: fallback_key(row, include_part_sr_no=False),
    )

    used_ecinet_ids: set[int] = set()
    matched_by_ecinet_id: dict[int, tuple[dict[str, str], str, str]] = {}
    old_only: list[tuple[dict[str, str], str]] = []
    stats: Counter[str] = Counter()

    for old in old_rows:
        old_epic = normalize_epic(old.get("epic_number"))
        ecinet: dict[str, str] | None = None
        match_key = old_epic
        confidence = ""
        duplicate_ecinet = False

        if old_epic:
            candidate = by_epic.get(old_epic)
            if candidate is not None:
                if id(candidate) in used_ecinet_ids:
                    duplicate_ecinet = True
                else:
                    ecinet = candidate
                    confidence = "epic"

        if ecinet is None and not duplicate_ecinet:
            key = fallback_key(
                {
                    "name": old.get("name", ""),
                    "relative_name": old.get("relative_name", ""),
                },
                include_part_sr_no=False,
            )
            candidate = by_name_relative.get(key)
            if candidate is not None and id(candidate) not in used_ecinet_ids:
                ecinet = candidate
                match_key = key
                confidence = "name_relative_fallback"

        if ecinet is not None:
            used_ecinet_ids.add(id(ecinet))
            matched_by_ecinet_id[id(ecinet)] = (old, match_key, confidence)
            stats[confidence] += 1
        else:
            reason = "old_only_duplicate_ecinet" if duplicate_ecinet else "old_only_unmatched"
            old_only.append((old, reason))
            stats[reason] += 1

    output_rows: list[dict[str, str]] = []

    # Keep every raw ECINET row exactly once and in its original order.
    for ecinet in ecinet_rows:
        match = matched_by_ecinet_id.get(id(ecinet))
        if match is None:
            merged = merge_row(
                {},
                ecinet,
                normalize_epic(ecinet.get("epic_number")),
                "ecinet_only",
            )
            merged["merge_notes"] = "ecinet_only_no_old_match"
            stats["ecinet_only"] += 1
        else:
            old, match_key, confidence = match
            merged = merge_row(old, ecinet, match_key, confidence)
        output_rows.append(merged)

    # Preserve cleaned rows that could not be consumed by a unique raw row.
    for old, reason in old_only:
        match_key = normalize_epic(old.get("epic_number")) or fallback_key(
            {"name": old.get("name", ""), "relative_name": old.get("relative_name", "")},
            include_part_sr_no=False,
        )
        merged = merge_row(old, None, match_key, reason)
        merged["merge_notes"] = reason
        output_rows.append(merged)

    raw_backed_rows = [row for row in output_rows if clean_text(row.get("ecinet_s_no"))]
    raw_snos = [clean_text(row.get("ecinet_s_no")) for row in raw_backed_rows]
    if len(raw_backed_rows) != len(ecinet_rows) or len(set(raw_snos)) != len(raw_snos):
        raise RuntimeError("Lossless merge invariant failed: raw ECINET rows are not represented exactly once")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    merged_path = args.output_dir / DEFAULT_MERGED_NAME
    write_csv(merged_path, output_rows)

    split_rows = {
        "PROGENY": [row for row in raw_backed_rows if category(row) == "PROGENY"],
        "SELF": [row for row in raw_backed_rows if category(row) == "SELF"],
        "ANOMALIES": [row for row in raw_backed_rows if is_anomaly(row)],
    }
    split_paths: dict[str, Path] = {}
    for label, rows in split_rows.items():
        path = args.output_dir / f"ecinet_1_1530_{label}.csv"
        write_csv(path, rows)
        split_paths[label] = path

    simple_exports = {
        "merged.csv": output_rows,
        "progeny.csv": split_rows["PROGENY"],
        "self.csv": split_rows["SELF"],
        "anomalies.csv": split_rows["ANOMALIES"],
    }
    simple_paths: dict[str, Path] = {}
    for filename, rows in simple_exports.items():
        path = args.output_dir / filename
        write_simple_csv(path, rows)
        simple_paths[filename] = path

    print(f"Old rows: {len(old_rows)}")
    print(f"ECINET rows: {len(ecinet_rows)}")
    print(f"Matched by EPIC: {stats['epic']}")
    print(f"Matched by fallback: {stats['name_relative_fallback']}")
    print(f"ECINET-only rows: {stats['ecinet_only']}")
    print(f"Old-only unmatched rows: {stats['old_only_unmatched']}")
    print(f"Old-only duplicate rows: {stats['old_only_duplicate_ecinet']}")
    print(f"Lossless merged rows: {len(output_rows)}")
    print(f"PROGENY rows: {len(split_rows['PROGENY'])}")
    print(f"SELF rows: {len(split_rows['SELF'])}")
    print(f"ANOMALIES rows: {len(split_rows['ANOMALIES'])}")
    print(f"Wrote: {merged_path}")
    for label, path in split_paths.items():
        print(f"Wrote {label}: {path}")
    for filename, path in simple_paths.items():
        print(f"Wrote simplified {filename}: {path}")


if __name__ == "__main__":
    main()
