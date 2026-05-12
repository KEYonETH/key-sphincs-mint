#!/usr/bin/env python3
import base64
import subprocess
import sys
from pathlib import Path


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def main() -> int:
    if len(sys.argv) != 4:
        print("Usage: sign_sphincsminus.py <private_key> <message_b64> <output_sig_file>", file=sys.stderr)
        return 2

    private_key, message_b64, output_sig_file = sys.argv[1], sys.argv[2], sys.argv[3]
    script = project_root() / "backend" / "vendor" / "sphincsminus" / "sphincs_minus.py"

    try:
        message = base64.b64decode(message_b64, validate=True).decode("utf-8")
        output_path = Path(output_sig_file).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            [sys.executable, str(script), "sign", private_key, message, str(output_path)],
            cwd=str(script.parent),
            text=True,
            capture_output=True,
        )
        if result.returncode == 0:
            print("OK")
            return 0

        # Some sphincsminus snapshots print signature hex instead of writing a file.
        fallback = subprocess.run(
            [sys.executable, str(script), "sign", private_key, message],
            cwd=str(script.parent),
            text=True,
            capture_output=True,
        )
        sig_hex = fallback.stdout.strip().splitlines()[-1] if fallback.stdout.strip() else ""
        if fallback.returncode == 0 and sig_hex.lower().startswith("0x"):
            output_path.write_bytes(bytes.fromhex(sig_hex[2:]))
            print("OK")
            return 0

        print(result.stderr.strip() or fallback.stderr.strip() or "sign failed", file=sys.stderr)
        return 1
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
