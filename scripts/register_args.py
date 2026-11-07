"""Build arguments for Symbolon from a capture made by capture_attestation.py.

  python scripts/register_args.py <capture.json> <model|gateway> register <profile>
      -> base64 borsh args for `register_attested`
  python scripts/register_args.py <capture.json> <model|gateway> profile <profile>
      -> JSON args for `set_profile` with this candidate's measurements
"""
import base64
import json
import struct
import sys


def b_bytes(b: bytes) -> bytes:
    return struct.pack("<I", len(b)) + b


def b_str(s: str) -> bytes:
    return b_bytes(s.encode("utf-8"))


def register_args(profile: str, c: dict) -> bytes:
    col = c["collateral"]
    out = b_str(profile)
    out += b_str(c["signing_address"])
    out += b_bytes(bytes.fromhex(c["intel_quote"]))  # QuoteBytes(Vec<u8>)
    out += b_str(col["pck_crl_issuer_chain"])
    out += b_bytes(bytes.fromhex(col["root_ca_crl"]))
    out += b_bytes(bytes.fromhex(col["pck_crl"]))
    out += b_str(col["tcb_info_issuer_chain"])
    out += b_str(col["tcb_info"])
    out += b_bytes(bytes.fromhex(col["tcb_info_signature"]))
    out += b_str(col["qe_identity_issuer_chain"])
    out += b_str(col["qe_identity"])
    out += b_bytes(bytes.fromhex(col["qe_identity_signature"]))
    pck = col.get("pck_certificate_chain")
    out += (b"\x01" + b_str(pck)) if pck else b"\x00"
    out += b_str(c["app_compose"])
    return out


def main():
    path, which, mode, profile = sys.argv[1:5]
    c = json.load(open(path))["candidates"][which]
    if mode == "register":
        print(base64.b64encode(register_args(profile, c)).decode())
    elif mode == "profile":
        m = c["measurements"]
        print(json.dumps({"profile": profile, "measurements": {
            "mr_td": [m["mr_td"]], "rt_mr0": [m["rt_mr0"]], "rt_mr1": [m["rt_mr1"]],
            "rt_mr2": [m["rt_mr2"]], "compose_hashes": [m["compose_hash"]]}}))
    else:
        raise SystemExit("mode must be register or profile")


if __name__ == "__main__":
    main()
