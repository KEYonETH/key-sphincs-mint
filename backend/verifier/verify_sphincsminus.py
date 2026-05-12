#!/usr/bin/env python3
import base64
import subprocess
import sys
import tempfile
from pathlib import Path


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def decode_message(message_b64: str) -> str:
    return base64.b64decode(message_b64, validate=True).decode("utf-8")


def signature_bytes(signature_hex: str) -> bytes:
    value = signature_hex[2:] if signature_hex.lower().startswith("0x") else signature_hex
    if not value or len(value) % 2 != 0:
        raise ValueError("signature_hex must be even-length hex")
    return bytes.fromhex(value)


def run_verify(pubkey: str, message: str, sig_file: str, signature_hex: str) -> subprocess.CompletedProcess:
    script = project_root() / "backend" / "vendor" / "sphincsminus" / "sphincs_minus.py"
    if not script.exists():
        raise FileNotFoundError(f"missing sphincs_minus.py at {script}")

    cmd = [sys.executable, str(script), "verify", pubkey, message, sig_file]
    result = subprocess.run(cmd, cwd=str(script.parent), text=True, capture_output=True)
    output = f"{result.stdout}\n{result.stderr}".upper()
    if "VERIFIED" in output:
        return result

    # Some sphincsminus snapshots accept signature hex instead of a signature file.
    fallback = [sys.executable, str(script), "verify", pubkey, message, signature_hex]
    return subprocess.run(fallback, cwd=str(script.parent), text=True, capture_output=True)


def main() -> int:
    if len(sys.argv) != 4:
        print("Usage: verify_sphincsminus.py <pubkey> <message_b64> <signature_hex>", file=sys.stderr)
        return 2

    pubkey, message_b64, signature_hex = sys.argv[1], sys.argv[2], sys.argv[3]

    try:
        message = decode_message(message_b64)
        sig = signature_bytes(signature_hex)
        with tempfile.NamedTemporaryFile(prefix="key_sphincs_", suffix=".sig", delete=False) as tmp:
            tmp.write(sig)
            sig_path = tmp.name

        try:
            result = run_verify(pubkey, message, sig_path, signature_hex)
            output = f"{result.stdout}\n{result.stderr}".upper()
            if result.returncode == 0 and ("VERIFIED" in output or "TRUE" in output or "VALID" in output):
                print("VALID")
                return 0
            print("INVALID")
            if result.stdout:
                print(result.stdout.strip(), file=sys.stderr)
            if result.stderr:
                print(result.stderr.strip(), file=sys.stderr)
            return 1
        finally:
            Path(sig_path).unlink(missing_ok=True)
    except Exception as exc:
        print("INVALID")
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
