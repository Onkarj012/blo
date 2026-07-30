#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

try:
    import pytesseract
    from PIL import Image
    from pytesseract import Output
except ModuleNotFoundError:
    pytesseract = None
    Image = None
    Output = None


OUTPUT_COLUMNS = [
    "source_image",
    "applicant_name",
    "epic_number",
    "gender",
    "age",
    "relative_name",
    "relative_type",
    "mobile_number",
    "address",
    "assembly_constituency",
    "district",
    "raw_ocr_text",
    "parse_status",
]

CLEANED_OUTPUT_COLUMNS = [
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

LABEL_ALIASES = {
    "applicant_name": ["applicant name"],
    "epic_number": ["epic number"],
    "gender": ["gender"],
    "age": ["age"],
    "relative_name": ["relative name"],
    "relative_type": ["relative type"],
    "mobile_number": ["mobile number"],
    "address": ["address"],
    "assembly_constituency": ["assembly constituency"],
    "district": ["district"],
}

SECTION_HEADERS = {
    "basic details",
    "ac details",
}

MIN_LINE_CONFIDENCE = 35.0


@dataclass
class FolderSummary:
    folder: str
    images_processed: int
    rows_written: int
    ok_rows: int
    partial_rows: int
    failed_rows: int
    raw_output_csv: str
    cleaned_output_csv: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract structured profile data from PNG screenshots into CSV files."
    )
    parser.add_argument(
        "--folder",
        action="append",
        help="Process a single folder inside data/input, for example 1_100.",
    )
    parser.add_argument(
        "--input-dir",
        type=Path,
        help="Override the default input directory.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Override the default output directory for both raw and cleaned CSVs.",
    )
    parser.add_argument(
        "--raw-output-dir",
        type=Path,
        help="Override the output directory for detailed/raw CSVs.",
    )
    parser.add_argument(
        "--cleaned-output-dir",
        type=Path,
        help="Override the output directory for cleaned CSVs.",
    )
    parser.add_argument(
        "--log-dir",
        type=Path,
        help="Override the default log directory.",
    )
    return parser.parse_args()


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def simplify(text: str) -> str:
    lowered = text.lower().replace("&", "and")
    lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def clean_line(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^[~`'\"‘’.,;:|\\/\-]+", "", text).strip()
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_phone(value: str) -> str:
    cleaned = clean_line(value).upper()
    if not cleaned or cleaned in {"NA", "N A", "N/A"}:
        return "NA"

    digits = re.sub(r"\D", "", cleaned)
    if len(digits) < 10:
        return "NA"

    plausible_mobile = re.search(r"(?:91)?([6-9]\d{9})", digits)
    if plausible_mobile:
        return f"+91-{plausible_mobile.group(1)}"

    if cleaned.startswith("+"):
        return re.sub(r"\s+", "", value)

    if len(digits) == 10:
        return f"+91-{digits}"

    if len(digits) == 12 and digits.startswith("91"):
        return f"+91-{digits[2:]}"

    return re.sub(r"\s+", "", value)


def normalize_gender(value: str) -> str:
    cleaned = simplify(value)
    if "female" in cleaned:
        return "Female"
    if "male" in cleaned:
        return "Male"
    if "other" in cleaned:
        return "Other"
    return clean_line(value)


def normalize_age(value: str) -> str:
    match = re.search(r"\b(\d{1,3})\b", value)
    return match.group(1) if match else ""


def normalize_epic(value: str) -> str:
    cleaned = clean_line(value).upper().replace(" ", "")
    match = re.search(r"\b([A-Z]{3}\d{7})\b", cleaned)
    return match.group(1) if match else cleaned


def smart_title_case(value: str) -> str:
    cleaned = clean_line(value)
    if not cleaned:
        return ""

    parts = cleaned.split(" ")
    normalized_parts: list[str] = []
    for part in parts:
        if not part:
            continue
        if any(char.isdigit() for char in part):
            normalized_parts.append(part.upper())
            continue
        normalized_parts.append(part.capitalize())
    return " ".join(normalized_parts)


def normalize_relative_type(value: str) -> str:
    cleaned = simplify(value)
    if "father" in cleaned:
        return "Father"
    if "mother" in cleaned:
        return "Mother"
    if "husband" in cleaned:
        return "Husband"
    if "wife" in cleaned:
        return "Wife"
    return smart_title_case(value)


def dedupe_consecutive(values: Iterable[str]) -> list[str]:
    deduped: list[str] = []
    for value in values:
        if not value:
            continue
        if deduped and simplify(deduped[-1]) == simplify(value):
            continue
        deduped.append(value)
    return deduped


def detect_label(line: str) -> str | None:
    simplified = simplify(line)
    if not simplified:
        return None

    for field, aliases in LABEL_ALIASES.items():
        for alias in aliases:
            if simplified == alias or alias in simplified:
                return field
    return None


def line_groups_from_ocr(image: Image.Image) -> tuple[str, list[str]]:
    if pytesseract is None or Output is None:
        raise RuntimeError("pytesseract and Pillow are required for OCR extraction.")

    config = "--psm 6"
    raw_text = pytesseract.image_to_string(image, config=config).strip()
    data = pytesseract.image_to_data(image, config=config, output_type=Output.DICT)

    grouped: dict[tuple[int, int, int], dict[str, list[float] | list[str] | int]] = {}
    order: list[tuple[int, int, int]] = []

    for index, text in enumerate(data["text"]):
        token = text.strip()
        if not token:
            continue

        key = (
            int(data["block_num"][index]),
            int(data["par_num"][index]),
            int(data["line_num"][index]),
        )
        if key not in grouped:
            grouped[key] = {"tokens": [], "confs": []}
            order.append(key)

        grouped[key]["tokens"].append(token)
        try:
            confidence = float(data["conf"][index])
        except ValueError:
            confidence = -1.0
        if confidence >= 0:
            grouped[key]["confs"].append(confidence)

    cleaned_lines: list[str] = []
    for key in order:
        info = grouped[key]
        tokens = info["tokens"]
        confs = info["confs"]
        line = clean_line(" ".join(tokens))
        avg_conf = sum(confs) / len(confs) if confs else 0.0

        if not line:
            continue
        if detect_label(line) or simplify(line) in SECTION_HEADERS:
            cleaned_lines.append(line)
            continue
        if avg_conf < MIN_LINE_CONFIDENCE:
            continue
        cleaned_lines.append(line)

    return raw_text, dedupe_consecutive(cleaned_lines)


def parse_sections(lines: list[str]) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = defaultdict(list)
    current_field: str | None = None

    for line in lines:
        simplified = simplify(line)
        if simplified in SECTION_HEADERS:
            current_field = None
            continue

        label = detect_label(line)
        if label:
            current_field = label
            continue

        if current_field:
            sections[current_field].append(line)

    return sections


def first_value(values: list[str]) -> str:
    for value in values:
        cleaned = clean_line(value)
        if cleaned:
            return cleaned
    return ""


def normalize_address(values: list[str]) -> str:
    cleaned_values = dedupe_consecutive(clean_line(value) for value in values)
    if not cleaned_values:
        return ""

    preferred: list[str] = []
    for value in cleaned_values:
        simplified = simplify(value)
        if not simplified:
            continue
        if simplified in SECTION_HEADERS:
            continue
        if detect_label(value):
            continue
        if re.fullmatch(r"[a-z]?\d+[a-z]?(?:\s*,?\s*[a-z]?\d+[a-z]?)*", simplified):
            preferred.append(value)
            continue
        if re.search(
            r"\b(society|apartment|apartments|residency|residence|colony|nagar|"
            r"heights|hights|park|garden|palace|avenue|road|lane|wasti|vasti|"
            r"pimple|pimpale|saudagar|pune)\b",
            simplified,
        ):
            preferred.append(value)

    selected_values = preferred or cleaned_values
    return ", ".join(value for value in selected_values if value)


def build_cleaned_row(row: dict[str, str]) -> dict[str, str]:
    phone_number = row["mobile_number"]
    if phone_number == "NA":
        phone_number = ""

    return {
        "name": smart_title_case(row["applicant_name"]),
        "phone_number": phone_number,
        "address": smart_title_case(row["address"]),
        "age": row["age"],
        "gender": row["gender"],
        "relative_name": smart_title_case(row["relative_name"]),
        "relative_type": normalize_relative_type(row["relative_type"]),
        "epic_number": row["epic_number"],
        "assembly_constituency": smart_title_case(row["assembly_constituency"]),
        "district": smart_title_case(row["district"]),
    }


def build_row(image_path: Path, raw_text: str, sections: dict[str, list[str]]) -> dict[str, str]:
    row = {column: "" for column in OUTPUT_COLUMNS}
    row["source_image"] = str(image_path)
    row["raw_ocr_text"] = raw_text

    row["applicant_name"] = first_value(sections.get("applicant_name", []))
    row["epic_number"] = normalize_epic(first_value(sections.get("epic_number", [])))
    row["gender"] = normalize_gender(first_value(sections.get("gender", [])))
    row["age"] = normalize_age(first_value(sections.get("age", [])))
    row["relative_name"] = first_value(sections.get("relative_name", []))
    row["relative_type"] = first_value(sections.get("relative_type", []))
    row["mobile_number"] = normalize_phone(first_value(sections.get("mobile_number", [])))
    row["address"] = normalize_address(sections.get("address", []))
    row["assembly_constituency"] = first_value(sections.get("assembly_constituency", []))
    row["district"] = first_value(sections.get("district", []))

    if not raw_text:
        row["parse_status"] = "ocr_failed"
        return row

    required_for_ok = [
        row["applicant_name"],
        row["epic_number"],
        row["gender"],
        row["age"],
    ]
    if all(required_for_ok):
        row["parse_status"] = "ok"
    elif row["applicant_name"] or row["epic_number"]:
        row["parse_status"] = "partial"
    else:
        row["parse_status"] = "ocr_failed"

    return row


def ensure_tesseract_available() -> None:
    if pytesseract is None or Image is None:
        raise SystemExit(
            "pytesseract and Pillow are not installed. Install them before running OCR extraction."
        )
    if shutil.which("tesseract"):
        return
    raise SystemExit(
        "Tesseract is not installed or not available on PATH. Install it before running this script."
    )


def collect_images(folder: Path) -> list[Path]:
    return sorted(path for path in folder.iterdir() if path.is_file() and path.suffix.lower() == ".png")


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def process_folder(folder: Path, raw_output_dir: Path, cleaned_output_dir: Path) -> FolderSummary:
    if Image is None:
        raise RuntimeError("Pillow is required for OCR extraction.")

    images = collect_images(folder)
    rows: list[dict[str, str]] = []

    for image_path in images:
        try:
            with Image.open(image_path) as image:
                raw_text, cleaned_lines = line_groups_from_ocr(image)
        except Exception:
            rows.append(
                {
                    "source_image": str(image_path),
                    "applicant_name": "",
                    "epic_number": "",
                    "gender": "",
                    "age": "",
                    "relative_name": "",
                    "relative_type": "",
                    "mobile_number": "",
                    "address": "",
                    "assembly_constituency": "",
                    "district": "",
                    "raw_ocr_text": "",
                    "parse_status": "ocr_failed",
                }
            )
            continue

        sections = parse_sections(cleaned_lines)
        rows.append(build_row(image_path, raw_text, sections))

    cleaned_rows = [build_cleaned_row(row) for row in rows]

    raw_output_csv = raw_output_dir / f"{folder.name}.csv"
    cleaned_output_csv = cleaned_output_dir / f"{folder.name}_cleaned.csv"
    write_csv(raw_output_csv, OUTPUT_COLUMNS, rows)
    write_csv(cleaned_output_csv, CLEANED_OUTPUT_COLUMNS, cleaned_rows)

    ok_rows = sum(1 for row in rows if row["parse_status"] == "ok")
    partial_rows = sum(1 for row in rows if row["parse_status"] == "partial")
    failed_rows = sum(1 for row in rows if row["parse_status"] == "ocr_failed")

    return FolderSummary(
        folder=folder.name,
        images_processed=len(images),
        rows_written=len(rows),
        ok_rows=ok_rows,
        partial_rows=partial_rows,
        failed_rows=failed_rows,
        raw_output_csv=str(raw_output_csv),
        cleaned_output_csv=str(cleaned_output_csv),
    )


def write_run_log(log_dir: Path, summaries: list[FolderSummary]) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    log_path = log_dir / f"extract-run-{timestamp}.json"
    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "summaries": [summary.__dict__ for summary in summaries],
    }
    log_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    latest_path = log_dir / "latest-run.json"
    latest_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return log_path


def main() -> None:
    ensure_tesseract_available()

    args = parse_args()
    root = repo_root()
    input_dir = (args.input_dir or root / "data" / "input").resolve()
    default_output_dir = (args.output_dir or root / "data" / "output").resolve()
    raw_output_dir = (args.raw_output_dir or default_output_dir).resolve()
    cleaned_output_dir = (args.cleaned_output_dir or default_output_dir).resolve()
    log_dir = (args.log_dir or root / "data" / "logs").resolve()

    raw_output_dir.mkdir(parents=True, exist_ok=True)
    cleaned_output_dir.mkdir(parents=True, exist_ok=True)
    log_dir.mkdir(parents=True, exist_ok=True)

    if args.folder:
        folders = [input_dir / folder_name for folder_name in args.folder]
    else:
        folders = sorted(path for path in input_dir.iterdir() if path.is_dir())

    missing = [folder for folder in folders if not folder.exists()]
    if missing:
        missing_names = ", ".join(str(folder) for folder in missing)
        raise SystemExit(f"Input folder not found: {missing_names}")

    summaries = [
        process_folder(folder, raw_output_dir, cleaned_output_dir) for folder in folders
    ]
    log_path = write_run_log(log_dir, summaries)

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
    print(f"Run log: {log_path}")


if __name__ == "__main__":
    main()
