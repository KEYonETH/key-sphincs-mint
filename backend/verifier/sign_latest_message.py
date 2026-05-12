#!/usr/bin/env python3
import base64
import subprocess
import sys
from pathlib import Path


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def copy_to_clipboard(value: str) -> bool:
    if sys.platform != "win32":
        return False
    try:
        subprocess.run("clip", input=value, text=True, check=True)
        return True
    except Exception:
        return False


def main() -> int:
    root = project_root()
    data_dir = root / "backend" / "data"
    private_file = data_dir / "sphincs_private_key.txt"
    public_file = data_dir / "sphincs_public_key.txt"
    message_file = data_dir / "message.txt"
    sig_file = data_dir / "key_sig.bin"
    sig_hex_file = data_dir / "sphincs_signature_hex.txt"
    signer = root / "backend" / "verifier" / "sign_sphincsminus.py"
    verifier = root / "backend" / "verifier" / "verify_sphincsminus.py"

    if not private_file.exists():
        print(f"Missing {private_file}. Run create_sphincs_test_key.py first.", file=sys.stderr)
        return 1
    if not message_file.exists():
        print(f"Missing {message_file}. Click Sign in the UI first.", file=sys.stderr)
        return 1

    private_key = private_file.read_text(encoding="utf-8").strip()
    message = message_file.read_text(encoding="utf-8")
    message_b64 = base64.b64encode(message.encode("utf-8")).decode("ascii")

    result = subprocess.run(
        [sys.executable, str(signer), private_key, message_b64, str(sig_file)],
        cwd=str(root),
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        print(result.stderr.strip() or result.stdout.strip() or "SPHINCS signing failed", file=sys.stderr)
        return 1

    sig_hex = "0x" + sig_file.read_bytes().hex()
    sig_hex_file.write_text(sig_hex + "\n", encoding="utf-8")

    if public_file.exists():
        public_key = public_file.read_text(encoding="utf-8").strip()
        verify = subprocess.run(
            [sys.executable, str(verifier), public_key, message_b64, sig_hex],
            cwd=str(root),
            text=True,
            capture_output=True,
        )
        if verify.returncode != 0:
            print("Signature was created but local verification failed.", file=sys.stderr)
            print(verify.stdout.strip(), file=sys.stderr)
            print(verify.stderr.strip(), file=sys.stderr)
            return 1

    copied = copy_to_clipboard(sig_hex)
    print("OK")
    print(f"Signature binary: {sig_file}")
    print(f"Signature hex:    {sig_hex_file}")
    if copied:
        print("Signature hex copied to clipboard.")
    else:
        print("Copy the signature hex from the file above.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
