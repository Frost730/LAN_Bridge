import pytest
import os
from pathlib import Path
from app.security.sanitization import sanitize_filename, sanitize_relative_path, get_unique_destination_path

def test_sanitize_filename_basic():
    assert sanitize_filename("simple.txt") == "simple.txt"
    assert sanitize_filename("My Vacation Photo.JPG") == "My Vacation Photo.JPG"

def test_sanitize_filename_unsafe_chars():
    # Invalid characters: < > : " | ? *
    assert ":" not in sanitize_filename("video:stream.mp4")
    assert "<" not in sanitize_filename("file<1>.zip")
    assert "?" not in sanitize_filename("who?where.pdf")
    assert "*" not in sanitize_filename("all*files.txt")
    assert "\0" not in sanitize_filename("evil.txt\0.png")

def test_sanitize_filename_windows_reserved():
    assert sanitize_filename("CON.txt") == "safe_CON.txt"
    assert sanitize_filename("prn.doc") == "safe_prn.doc"
    assert sanitize_filename("AUX") == "safe_AUX"
    assert sanitize_filename("NUL") == "safe_NUL"

def test_sanitize_filename_empty_or_dots():
    assert sanitize_filename("") == "unnamed_file"
    assert sanitize_filename(".") == "unnamed_file"
    assert sanitize_filename("..") == "unnamed_file"

def test_sanitize_relative_path_traversal_attempts(tmp_path):
    base_dir = tmp_path / "received"
    base_dir.mkdir()

    # Traversals using ../ or ..\
    traversal_attacks = [
        "../../test.txt",
        "..\\..\\test.txt",
        "/etc/passwd",
        "/var/log/syslog",
        "C:\\Windows\\System32\\cmd.exe",
        "C:secret.txt",
        "subfolder/../../../escape.txt",
        "a/b/../../../../root.txt"
    ]

    for attack in traversal_attacks:
        # Either sanitizes to inside base_dir or raises ValueError
        try:
            resolved = sanitize_relative_path(attack, base_dir)
            # Crucial: must be strictly inside base_dir
            assert os.path.commonpath([str(base_dir.resolve()), str(resolved)]) == str(base_dir.resolve())
            assert not str(resolved).lower().startswith("c:\\windows")
            assert str(resolved) != "/etc/passwd"
        except ValueError:
            # Traversal safely blocked by exception
            pass

def test_sanitize_relative_path_legitimate_nested_folders(tmp_path):
    base_dir = tmp_path / "received"
    base_dir.mkdir()

    valid_folder_path = "Project/src/components/App.tsx"
    resolved = sanitize_relative_path(valid_folder_path, base_dir)

    assert os.path.commonpath([str(base_dir.resolve()), str(resolved)]) == str(base_dir.resolve())
    assert resolved.name == "App.tsx"
    assert "components" in str(resolved)

def test_get_unique_destination_path(tmp_path):
    target = tmp_path / "document.txt"
    target.write_text("first")

    unique1 = get_unique_destination_path(target)
    assert unique1.name == "document (1).txt"

    unique1.write_text("second")
    unique2 = get_unique_destination_path(target)
    assert unique2.name == "document (2).txt"
