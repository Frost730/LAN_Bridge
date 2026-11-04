import os
import re
from pathlib import Path
from typing import Union

# Reserved Windows file names
RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
}

# Invalid characters across OS: \ / : * ? " < > | \0
UNSAFE_CHARS_REGEX = re.compile(r'[<>:"|?*\x00-\x1f]')

def sanitize_filename(filename: str) -> str:
    """
    Sanitizes a single filename (not path) to prevent traversal and invalid characters.
    """
    if not filename:
        return "unnamed_file"

    # Remove null bytes and trailing spaces/dots (problematic on Windows)
    name = filename.replace("\0", "").strip(" .\t\r\n")

    # If full path was provided accidentally, extract only the name
    name = os.path.basename(name)

    # Remove unsafe characters
    name = UNSAFE_CHARS_REGEX.sub("_", name)

    # Check reserved DOS names
    stem = Path(name).stem.upper()
    if stem in RESERVED_NAMES:
        name = f"safe_{name}"

    if not name or name == "." or name == "..":
        return "unnamed_file"

    # Limit length to 255 chars
    if len(name) > 255:
        ext = Path(name).suffix[:16]
        name = name[:255 - len(ext)] + ext

    return name

def sanitize_relative_path(relative_path: str, base_dir: Union[str, Path]) -> Path:
    """
    Sanitizes a relative path (e.g. for folder transfers like 'src/components/App.tsx')
    and resolves it strictly inside base_dir.
    Raises ValueError if path attempts traversal outside base_dir.
    """
    base_path = Path(base_dir).resolve()

    if not relative_path:
        raise ValueError("Relative path cannot be empty")

    # Replace backslashes with forward slashes for uniform splitting
    normalized = relative_path.replace("\\", "/").replace("\0", "")

    # Strip Windows drive letters (e.g., C:)
    if len(normalized) >= 2 and normalized[1] == ":":
        normalized = normalized[2:]

    # Strip leading slashes
    normalized = normalized.lstrip("/")

    # Split into parts and sanitize each individual part
    raw_parts = [p.strip() for p in normalized.split("/") if p.strip()]
    safe_parts = []

    for part in raw_parts:
        # Prevent traversal
        if part in (".", ".."):
            continue
        safe_part = sanitize_filename(part)
        if safe_part:
            safe_parts.append(safe_part)

    if not safe_parts:
        raise ValueError("Invalid or empty relative path after sanitization")

    # Construct the destination path
    dest_path = base_path.joinpath(*safe_parts).resolve()

    # Strict check: dest_path MUST be inside base_path
    try:
        common = os.path.commonpath([str(base_path), str(dest_path)])
        if common != str(base_path):
            raise ValueError(f"Path traversal detected: {relative_path}")
    except ValueError as e:
        raise ValueError(f"Path traversal detected: {e}")

    return dest_path

def get_unique_destination_path(target_path: Path) -> Path:
    """
    If a file already exists at target_path, generate a unique filename with suffix '(1)', '(2)', etc.
    """
    if not target_path.exists():
        return target_path

    parent = target_path.parent
    stem = target_path.stem
    suffix = target_path.suffix
    counter = 1

    while True:
        candidate = parent / f"{stem} ({counter}){suffix}"
        if not candidate.exists():
            return candidate
        counter += 1

def is_safe_subpath(child_path: Union[str, Path], base_dir: Union[str, Path]) -> bool:
    """
    Verifies that child_path resolves strictly within base_dir (preventing path traversal).
    Returns False if path attempts to escape base_dir or on invalid input.
    """
    try:
        base_resolved = Path(base_dir).resolve()
        child_resolved = Path(child_path).resolve()
        return child_resolved.is_relative_to(base_resolved)
    except Exception:
        return False

