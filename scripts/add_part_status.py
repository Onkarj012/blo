#!/usr/bin/env python3

"""Add CSV-driven pending/done status for a part's serial-number list."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path


DEFAULT_INPUT = Path("data/output/merged/ecinet_1_1530_lossless_merged.csv")
DEFAULT_OUTPUT = Path("data/output/merged/ecinet_1_1530_part_355_status.csv")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Add a status column using pending part serial numbers."
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--pending-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def clean(value: str | None) -> str:
    return " ".join((value or "").split())


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def main() -> None:
    args = parse_args()
    rows = read_rows(args.input)
    pending_serials = {
        value.strip()
        for value in args.pending_file.read_text(encoding="utf-8-sig").split()
        if value.strip()
    }

    # Keep only records belonging to the part. This avoids importing leftover
    # rows from the lossless merge that have no part serial number.
    part_rows = [row for row in rows if clean(row.get("ecinet_part_sr_no"))]
    for row in part_rows:
        if not clean(row.get("name")):
            row["name"] = clean(row.get("ecinet_name"))
        if not clean(row.get("relative_name")):
            row["relative_name"] = clean(row.get("ecinet_relative_name"))
        row["status"] = (
            "pending"
            if clean(row.get("ecinet_part_sr_no")) in pending_serials
            else "done"
        )
        row["part_no"] = "355"
        row["part_serial_no"] = clean(row.get("ecinet_part_sr_no"))

    fieldnames = list(rows[0].keys()) if rows else []
    for fieldname in ("part_no", "part_serial_no", "status"):
        if fieldname not in fieldnames:
            fieldnames.append(fieldname)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(part_rows)

    pending_rows = sum(row["status"] == "pending" for row in part_rows)
    print(f"Part rows: {len(part_rows)}")
    print(f"Pending rows: {pending_rows}")
    print(f"Done rows: {len(part_rows) - pending_rows}")
    print(f"Pending serials without source rows: {sorted(pending_serials - {clean(row.get('ecinet_part_sr_no')) for row in part_rows}, key=int)}")
    print(f"Wrote: {args.output}")


if __name__ == "__main__":
    main()
