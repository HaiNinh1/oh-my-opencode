import json
import re
import time
from pathlib import Path
from typing import Any

DIR = Path.home() / ".config" / "opencode" / "prompt-dumps"
DIR.mkdir(parents=True, exist_ok=True)

WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
}

def safe_filename(value: str, max_len: int = 160) -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value)
    value = value.rstrip(" .")

    if not value:
        value = "request"

    if value.upper() in WINDOWS_RESERVED_NAMES:
        value = f"_{value}"

    return value[:max_len]

def quote_string_readable(value: str) -> str:
    """
    JSON-like string formatter.

    It escapes quotes and backslashes, but keeps real newlines
    as actual newlines instead of "\\n".
    """
    out = '"'

    for ch in value:
        if ch == '"':
            out += '\\"'
        elif ch == "\\":
            out += "\\\\"
        elif ch == "\n":
            out += "\n"
        elif ch == "\r":
            # Ignore CR so Windows CRLF becomes readable LF.
            pass
        elif ch == "\t":
            out += "\\t"
        elif ord(ch) < 32:
            out += f"\\u{ord(ch):04x}"
        else:
            out += ch

    out += '"'
    return out

def dump_readable(value: Any, indent: int = 0) -> str:
    """
    Dump JSON-like text, but with multiline strings displayed
    using real line breaks.

    This is for debugging/readability, not machine parsing.
    """
    space = " " * indent
    next_indent = indent + 2
    next_space = " " * next_indent

    if isinstance(value, dict):
        if not value:
            return "{}"

        parts = ["{"]

        items = list(value.items())
        for i, (key, item) in enumerate(items):
            comma = "," if i < len(items) - 1 else ""
            key_text = json.dumps(str(key), ensure_ascii=False)
            item_text = dump_readable(item, next_indent)
            parts.append(f"{next_space}{key_text}: {item_text}{comma}")

        parts.append(f"{space}}}")
        return "\n".join(parts)

    if isinstance(value, list):
        if not value:
            return "[]"

        parts = ["["]

        for i, item in enumerate(value):
            comma = "," if i < len(value) - 1 else ""
            item_text = dump_readable(item, next_indent)
            parts.append(f"{next_space}{item_text}{comma}")

        parts.append(f"{space}]")
        return "\n".join(parts)

    if isinstance(value, str):
        return quote_string_readable(value)

    return json.dumps(value, ensure_ascii=False)

def request(flow):
    if flow.request.method != "POST":
        return

    try:
        body = json.loads(flow.request.content)
    except Exception:
        return

    ts = time.strftime("%Y-%m-%dT%H-%M-%S")
    ms = int((time.time() % 1) * 1000)

    host = safe_filename(flow.request.pretty_host)
    path = safe_filename(flow.request.path)

    base_name = f"{host}_{path}-{ts}-{ms:03d}"

    raw_path = DIR / f"{base_name}.raw.json"
    readable_path = DIR / f"{base_name}.readable.json"

    # Valid JSON version
    with raw_path.open("w", encoding="utf-8") as f:
        json.dump(body, f, indent=2, ensure_ascii=False)

    # Human-readable JSON-like version
    with readable_path.open("w", encoding="utf-8") as f:
        f.write(dump_readable(body))

    print(f"Dumped raw JSON:      {raw_path}")
    print(f"Dumped readable text: {readable_path}")