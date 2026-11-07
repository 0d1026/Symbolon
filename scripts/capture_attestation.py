"""Fetch a NEAR AI attestation report for a given nonce, fetch Intel collateral,
check it locally, and save it in the format the sandbox tests and the relayer use.

Usage:
  python scripts/capture_attestation.py <out.json> [nonce_hex]

With no nonce, a random one is generated (fine for test fixtures, which pin the
nonce with the `test-nonce` build). For a live registration, pass the nonce
returned by the contract's `request_attestation_nonce`.

Needs: pip install dcap-qvl requests
Reads NEAR_AI_CLOUD_API_KEY from the environment or ~/.nearai.env.
"""
import asyncio
import hashlib
import json
import os
import secrets
import sys
import time

import dcap_qvl
import requests

BASE = "https://cloud-api.near.ai/v1"
MODEL = "z-ai/glm-5.3-flash"


def api_key() -> str:
    if os.environ.get("NEAR_AI_CLOUD_API_KEY"):
        return os.environ["NEAR_AI_CLOUD_API_KEY"]
    path = os.path.expanduser("~/.nearai.env")
    for line in open(path):
        if line.startswith("NEAR_AI_CLOUD_API_KEY="):
            return line.strip().split("=", 1)[1]
    raise SystemExit("NEAR_AI_CLOUD_API_KEY not set")


def tcb_info(c):
    t = c["info"]["tcb_info"]
    return json.loads(t) if isinstance(t, str) else t


async def candidate(c, nonce):
    quote = bytes.fromhex(c["intel_quote"])
    col = await dcap_qvl.get_collateral(dcap_qvl.PHALA_PCCS_URL, quote)
    verified = dcap_qvl.verify(quote, col, int(time.time()))
    q = json.loads(verified.to_json())["report"]["TD10"]
    ident = bytes.fromhex(c["signing_address"].removeprefix("0x"))
    if bytes.fromhex(q["report_data"]) != ident.ljust(32, b"\0") + bytes.fromhex(nonce):
        raise SystemExit("report_data does not bind signer and nonce")
    t = tcb_info(c)
    return {
        "signing_address": c["signing_address"],
        "signing_algo": c["signing_algo"],
        "model_name": c.get("model_name"),
        "tcb_status": verified.status,
        "intel_quote": c["intel_quote"],
        "app_compose": t["app_compose"],
        "collateral": json.loads(col.to_json()),
        "measurements": {
            "mr_td": t["mrtd"],
            "rt_mr0": t["rtmr0"],
            "rt_mr1": t["rtmr1"],
            "rt_mr2": t["rtmr2"],
            "compose_hash": hashlib.sha256(t["app_compose"].encode("utf-8")).hexdigest(),
        },
    }


async def main(out, nonce):
    r = requests.get(
        f"{BASE}/attestation/report",
        params={"model": MODEL, "provider": "near", "signing_algo": "ecdsa", "nonce": nonce},
        headers={"Authorization": f"Bearer {api_key()}", "x-no-aliasing": "true"},
        timeout=120,
    )
    r.raise_for_status()
    rep = r.json()
    models = rep.get("model_attestations") or []
    if not models:
        raise SystemExit("no model attestation returned")
    doc = {
        "nonce": nonce,
        "fetched_at": int(time.time()),
        "model": MODEL,
        "candidates": {
            "model": await candidate(models[0], nonce),
            "gateway": await candidate(rep["gateway_attestation"], nonce),
        },
    }
    json.dump(doc, open(out, "w"), indent=1)
    for k, v in doc["candidates"].items():
        print(k, v["signing_address"], v["tcb_status"], "compose", v["measurements"]["compose_hash"][:16])
    print("saved", out)


if __name__ == "__main__":
    out = sys.argv[1]
    nonce = (sys.argv[2] if len(sys.argv) > 2 else secrets.token_hex(32)).lower()
    asyncio.run(main(out, nonce))
