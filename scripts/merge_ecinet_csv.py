#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import re
from collections import Counter
from pathlib import Path


DEFAULT_OLD_CSV = Path("data/output/clean/1_1530_cleaned.csv")
DEFAULT_ECINET_CSV = Path("data/ecinet_pre_sir_mapping_S13_205_355_1500_rows.csv")
DEFAULT_OUTPUT_CSV = Path("data/output/merged/ecinet_1_1530_merged.csv")

OLD_COLUMNS = [
    "name",
    "phone_number",
    "address",
    "age",
    "gender",
    "relative_name",
    "relative_type",
    "epic_number",
    "assembly_constituency",
    "district",
]

ECINET_COLUMNS_TO_APPEND = [
    "ecinet_s_no",
    "ecinet_part_sr_no",
    "ecinet_mapping_category",
    "ecinet_previous_state",
    "ecinet_previous_ac_no",
    "ecinet_previous_part_no",
    "ecinet_previous_part_sr_no",
    "ecinet_previous_elector_relative_details",
    "ecinet_discrepancy_flag",
    "ecinet_remark",
]

OUTPUT_COLUMNS = OLD_COLUMNS + [
    "ecinet_name",
    "ecinet_relative_name",
    "ecinet_relation_type",
    *ECINET_COLUMNS_TO_APPEND,
    "merge_match_key",
    "merge_match_confidence",
    "merge_notes",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Merge the cleaned screenshot CSV with the ECINET pre-SIR mapping CSV."
    )
    parser.add_argument("--old-csv", type=Path, default=DEFAULT_OLD_CSV)
    parser.add_argument("--ecinet-csv", type=Path, default=DEFAULT_ECINET_CSV)
    parser.add_argument("--output-csv", type=Path, default=DEFAULT_OUTPUT_CSV)
    return parser.parse_args()


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def clean_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_key(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", clean_text(value).lower()).strip()


def normalize_epic(value: str | None) -> str:
    cleaned = re.sub(r"\s+", "", clean_text(value).upper())
    return cleaned if re.fullmatch(r"[A-Z]{3}\d{7}", cleaned) else ""


def fallback_key(row: dict[str, str], *, include_part_sr_no: bool = True) -> str:
    parts = []
    if include_part_sr_no:
        parts.append(normalize_key(row.get("part_sr_no") or row.get("ecinet_part_sr_no")))
    parts.extend(
        [
            normalize_key(row.get("elector_name") or row.get("name")),
            normalize_key(row.get("relative_name")),
        ]
    )
    return "|".join(
        parts
    )


def build_ecinet_indexes(
    rows: list[dict[str, str]]
) -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]], dict[str, dict[str, str]]]:
    by_epic: dict[str, dict[str, str]] = {}
    by_part_name_relative: dict[str, dict[str, str]] = {}
    by_name_relative: dict[str, dict[str, str]] = {}
    duplicate_epics: set[str] = set()
    duplicate_part_name_relative: set[str] = set()
    duplicate_name_relative: set[str] = set()

    for row in rows:
        epic = normalize_epic(row.get("epic_number"))
        if epic:
            if epic in by_epic:
                duplicate_epics.add(epic)
            by_epic[epic] = row

        part_key = fallback_key(row)
        if part_key and part_key != "||":
            if part_key in by_part_name_relative:
                duplicate_part_name_relative.add(part_key)
            by_part_name_relative[part_key] = row

        name_key = fallback_key(row, include_part_sr_no=False)
        if name_key and name_key != "|":
            if name_key in by_name_relative:
                duplicate_name_relative.add(name_key)
            by_name_relative[name_key] = row

    for epic in duplicate_epics:
        by_epic.pop(epic, None)
    for key in duplicate_part_name_relative:
        by_part_name_relative.pop(key, None)
    for key in duplicate_name_relative:
        by_name_relative.pop(key, None)

    return by_epic, by_part_name_relative, by_name_relative


def merge_row(old: dict[str, str], ecinet: dict[str, str] | None, match_key: str, confidence: str) -> dict[str, str]:
    merged = {column: clean_text(old.get(column)) for column in OLD_COLUMNS}
    notes: list[str] = []

    if ecinet:
        merged["epic_number"] = normalize_epic(old.get("epic_number")) or normalize_epic(ecinet.get("epic_number"))
        merged["ecinet_name"] = clean_text(ecinet.get("elector_name"))
        merged["ecinet_relative_name"] = clean_text(ecinet.get("relative_name"))
        merged["ecinet_relation_type"] = clean_text(ecinet.get("relation_type"))
        merged["ecinet_s_no"] = clean_text(ecinet.get("s_no"))
        merged["ecinet_part_sr_no"] = clean_text(ecinet.get("part_sr_no"))
        merged["ecinet_mapping_category"] = clean_text(ecinet.get("mapping_category"))
        merged["ecinet_previous_state"] = clean_text(ecinet.get("previous_state"))
        merged["ecinet_previous_ac_no"] = clean_text(ecinet.get("previous_ac_no"))
        merged["ecinet_previous_part_no"] = clean_text(ecinet.get("previous_part_no"))
        merged["ecinet_previous_part_sr_no"] = clean_text(ecinet.get("previous_part_sr_no"))
        merged["ecinet_previous_elector_relative_details"] = clean_text(
            ecinet.get("previous_elector_relative_details")
        )
        merged["ecinet_discrepancy_flag"] = clean_text(ecinet.get("discrepancy_flag"))
        merged["ecinet_remark"] = clean_text(ecinet.get("remark"))

        if normalize_key(old.get("name")) and normalize_key(old.get("name")) != normalize_key(ecinet.get("elector_name")):
            notes.append("name_differs")
        if normalize_key(old.get("relative_name")) and normalize_key(old.get("relative_name")) != normalize_key(ecinet.get("relative_name")):
            notes.append("relative_name_differs")
    else:
        for column in OUTPUT_COLUMNS:
            merged.setdefault(column, "")
        notes.append("no_ecinet_match")

    merged["merge_match_key"] = match_key
    merged["merge_match_confidence"] = confidence
    merged["merge_notes"] = ";".join(notes)
    return merged


def main() -> None:
    args = parse_args()
    old_rows = read_rows(args.old_csv)
    ecinet_rows = read_rows(args.ecinet_csv)
    by_epic, _by_part_name_relative, by_name_relative = build_ecinet_indexes(ecinet_rows)

    output_rows: list[dict[str, str]] = []
    stats: Counter[str] = Counter()

    for old in old_rows:
        epic = normalize_epic(old.get("epic_number"))
        ecinet = by_epic.get(epic) if epic else None
        match_key = epic
        confidence = "epic"

        if not ecinet:
            key = fallback_key(
                {
                    "name": old.get("name", ""),
                    "relative_name": old.get("relative_name", ""),
                },
                include_part_sr_no=False,
            )
            ecinet = by_name_relative.get(key)
            match_key = key
            confidence = "name_relative_fallback" if ecinet else "unmatched"

        stats[confidence] += 1
        output_rows.append(merge_row(old, ecinet, match_key, confidence))

    args.output_csv.parent.mkdir(parents=True, exist_ok=True)
    with args.output_csv.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        writer.writerows(output_rows)

    print(f"Old rows: {len(old_rows)}")
    print(f"ECINET rows: {len(ecinet_rows)}")
    print(f"Matched by EPIC: {stats['epic']}")
    print(f"Matched by fallback: {stats['name_relative_fallback']}")
    print(f"Unmatched: {stats['unmatched']}")
    print(f"Wrote: {args.output_csv}")


if __name__ == "__main__":
    main()
