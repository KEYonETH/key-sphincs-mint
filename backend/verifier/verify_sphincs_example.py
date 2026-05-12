#!/usr/bin/env python3
"""
Example wrapper shape for SPHINCS verification.

Do NOT use this file as a real verifier. Replace the TODO section with a call to the
SPHINCS implementation you choose. The backend expects this script to print "ok"
for valid proofs and exit non-zero for invalid proofs.
"""
import argparse
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--pubkey', required=True)
parser.add_argument('--message-b64', required=True)
parser.add_argument('--signature', required=True)
args = parser.parse_args()

# TODO: import your SPHINCS verifier and verify:
# import base64
# message = base64.b64decode(args.message_b64).decode()
# valid = sphincs_verify(pubkey=args.pubkey, message=message, signature=args.signature)
valid = False

if valid:
    print('ok')
    sys.exit(0)

print('invalid: replace verify_sphincs_example.py with a real verifier', file=sys.stderr)
sys.exit(1)
