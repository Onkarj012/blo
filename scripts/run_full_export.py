#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

from extract_profiles import (
    CLEANED_OUTPUT_COLUMNS,
    FolderSummary,
    build_cleaned_row,
    ensure_tesseract_available,
    process_folder,
    repo_root,
    write_csv,
    write_run_log,
)


RANGE_PATTERN = re.compile(r"^(\d+)_(\d+)$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run OCR extraction for every input folder, then build cleaned hundred-range "
            "exports plus one combined cleaned CSV."
        )
    )
    parser.add_argument(
        "--input-dir",
        type=Path,
        help="Override the default input directory.",
    )
    parser.add_argument(
        "--raw-output-dir",
        type=Path,
        help="Override the per-folder raw output directory.",
    )
    parser.add_argument(
        "--folder-cleaned-dir",
        type=Path,
        help="Override the per-folder cleaned output directory.",
    )
    parser.add_argument(
        "--clean-output-dir",
        type=Path,
        help="Override the hundred-range cleaned output directory.",
    )
    parser.add_argument(
        "--log-dir",
        type=Path,
        help="Override the log directory.",
    )
    return parser.parse_args()


def parse_range_name(name: str) -> tuple[int, int]:
    match = RANGE_PATTERN.fullmatch(name)
    if not match:
        raise ValueError(f"Unsupported folder name: {name}")
    start, end = int(match.group(1)), int(match.group(2))
    if start > end:
        raise ValueError(f"Invalid range folder: {name}")
    return start, end


def bucket_name_from_bounds(start: int, end: int) -> str:
    return f"{start}_{end}"


def split_folder_range(start: int, end: int) -> list[tuple[int, int]]:
    buckets: list[tuple[int, int]] = []
    current_start = start
    while current_start <= end:
        current_end = min(((current_start - 1) // 100) * 100 + 100, end)
        buckets.append((current_start, current_end))
        current_start = current_end + 1
    return buckets


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def list_input_folders(input_dir: Path) -> list[Path]:
    folders = [path for path in input_dir.iterdir() if path.is_dir()]
    return sorted(folders, key=lambda path: parse_range_name(path.name))


def normalize_folder_bounds(
    folder_name: str,
    previous_end: int | None,
) -> tuple[int, int]:
    start, end = parse_range_name(folder_name)
    if previous_end is None:
        return start, end

    normalized_start = max(start, previous_end + 1)
    if normalized_start > end:
        raise ValueError(f"Range overlap is too large to normalize: {folder_name}")
    return normalized_start, end


def build_clean_exports(
    summaries: list[FolderSummary],
    clean_output_dir: Path,
) -> tuple[list[Path], Path]:
    clean_output_dir.mkdir(parents=True, exist_ok=True)
    ordered_buckets: list[tuple[str, list[dict[str, str]]]] = []
    previous_end: int | None = None

    for summary in sorted(summaries, key=lambda item: parse_range_name(item.folder)):
        raw_rows = read_csv_rows(Path(summary.raw_output_csv))
        cleaned_rows = [build_cleaned_row(raw_row) for raw_row in raw_rows]

        actual_start, actual_end = normalize_folder_bounds(summary.folder, previous_end)
        bucket_ranges = split_folder_range(actual_start, actual_end)
        cursor = 0
        for bucket_index, (bucket_start, bucket_end) in enumerate(bucket_ranges):
            bucket_name = bucket_name_from_bounds(bucket_start, bucket_end)
            if bucket_index == len(bucket_ranges) - 1:
                bucket_rows = cleaned_rows[cursor:]
            else:
                capacity = bucket_end - bucket_start + 1
                bucket_rows = cleaned_rows[cursor : cursor + capacity]
                cursor += capacity
            ordered_buckets.append((bucket_name, bucket_rows))

        previous_end = actual_end

    written_paths: list[Path] = []
    combined_rows: list[dict[str, str]] = []

    for bucket_name, bucket_rows in ordered_buckets:
        output_path = clean_output_dir / f"{bucket_name}_cleaned.csv"
        write_csv(output_path, CLEANED_OUTPUT_COLUMNS, bucket_rows)
        written_paths.append(output_path)
        combined_rows.extend(bucket_rows)

    min_start = parse_range_name(ordered_buckets[0][0])[0]
    max_end = parse_range_name(ordered_buckets[-1][0])[1]
    combined_path = clean_output_dir / f"{min_start}_{max_end}_cleaned.csv"
    write_csv(combined_path, CLEANED_OUTPUT_COLUMNS, combined_rows)
    return written_paths, combined_path


def main() -> None:
    args = parse_args()
    ensure_tesseract_available()
    root = repo_root()
    input_dir = (args.input_dir or root / "data" / "input").resolve()
    raw_output_dir = (args.raw_output_dir or root / "data" / "output" / "raw").resolve()
    folder_cleaned_dir = (
        args.folder_cleaned_dir or root / "data" / "output" / "cleaned"
    ).resolve()
    clean_output_dir = (
        args.clean_output_dir or root / "data" / "output" / "clean"
    ).resolve()
    log_dir = (args.log_dir or root / "data" / "logs").resolve()

    raw_output_dir.mkdir(parents=True, exist_ok=True)
    folder_cleaned_dir.mkdir(parents=True, exist_ok=True)
    clean_output_dir.mkdir(parents=True, exist_ok=True)
    log_dir.mkdir(parents=True, exist_ok=True)

    folders = list_input_folders(input_dir)
    if not folders:
        raise SystemExit(f"No input folders found in {input_dir}")

    summaries = [
        process_folder(folder, raw_output_dir, folder_cleaned_dir) for folder in folders
    ]
    log_path = write_run_log(log_dir, summaries)

    written_clean_paths, combined_clean_path = build_clean_exports(
        summaries=summaries,
        clean_output_dir=clean_output_dir,
    )

    total_images = sum(summary.images_processed for summary in summaries)
    total_rows = sum(summary.rows_written for summary in summaries)
    total_partials = sum(summary.partial_rows for summary in summaries)
    total_failures = sum(summary.failed_rows for summary in summaries)

    print(f"Processed folders: {', '.join(summary.folder for summary in summaries)}")
    print(f"Images processed: {total_images}")
    print(f"Rows written: {total_rows}")
    print(f"Partial rows: {total_partials}")
    print(f"OCR failed rows: {total_failures}")
    for summary in summaries:
        print(
            f"{summary.folder}: {summary.rows_written} rows -> {summary.raw_output_csv} "
            f"and {summary.cleaned_output_csv} "
            f"(ok={summary.ok_rows}, partial={summary.partial_rows}, failed={summary.failed_rows})"
        )
    print(f"Hundred-range clean exports: {len(written_clean_paths)} files in {clean_output_dir}")
    print(f"Combined clean export: {combined_clean_path}")
    print(f"Run log: {log_path}")


if __name__ == "__main__":
    main()
