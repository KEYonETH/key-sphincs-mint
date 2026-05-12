#!/usr/bin/env python3
import re
import secrets
import subprocess
import sys
from pathlib import Path


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def main() -> int:
    root = project_root()
    script = root / "backend" / "vendor" / "sphincsminus" / "sphincs_minus.py"
    data_dir = root / "backend" / "data"
    private_file = data_dir / "sphincs_private_key.txt"
    public_file = data_dir / "sphincs_public_key.txt"

    if not script.exists():
        print(f"Missing sphincsminus CLI at {script}", file=sys.stderr)
        return 1

    data_dir.mkdir(parents=True, exist_ok=True)
    private_key = "0x" + secrets.token_bytes(32).hex()
    result = subprocess.run(
        [sys.executable, str(script), "privtopub", private_key],
        cwd=str(script.parent),
        text=True,
        capture_output=True,
    )
    output = f"{result.stdout}\n{result.stderr}"
    if result.returncode != 0:
        print(output.strip() or "SPHINCS keygen failed", file=sys.stderr)
        return 1

    public_match = re.search(r"(0x[0-9a-fA-F]+)", output)
    if not public_match:
        print("Could not parse sphincsminus privtopub output:", file=sys.stderr)
        print(output.strip(), file=sys.stderr)
        return 1

    public_key = public_match.group(1)
    private_file.write_text(private_key + "\n", encoding="utf-8")
    public_file.write_text(public_key + "\n", encoding="utf-8")

    print("OK")
    print(f"Private key saved: {private_file}")
    print(f"Public key saved:  {public_file}")
    print("")
    print("Paste this public key into Advanced SPHINCS:")
    print(public_key)
    return 0


if __name__ == "__main__":
    sys.exit(main())
