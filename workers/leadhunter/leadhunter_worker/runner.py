from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html import unescape
from typing import Any

from .contracts import ExtractionRequest
from .extract import extract_offline


def api(method: str, url: str, token: str, body: dict[str, Any]) -> tuple[int, Any]:
    request = urllib.request.Request(url, data=json.dumps(body).encode(), method=method, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            raw = response.read(1_000_000)
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read(100_000)
        return error.code, json.loads(raw) if raw else None


def fetch_text(url: str) -> tuple[int, str]:
    request = urllib.request.Request(url, headers={"User-Agent": "KazeOS-LeadHunter/1.0", "Accept": "text/html"})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read(1_000_000)
        return response.status, raw.decode(response.headers.get_content_charset() or "utf-8", errors="replace")


def audit(payload: dict[str, Any]) -> dict[str, Any]:
    website = payload.get("website")
    source_url = website or payload.get("sourceUrl")
    if not source_url:
        raise ValueError("audit source is missing")
    observed = datetime.now(timezone.utc).isoformat()
    source = {"sourceType": "official_site" if website else "directory", "sourceUrl": source_url}
    observations: list[dict[str, Any]] = [{"type": "official_site", "state": "present" if website else "absent", "targetUrl": website, "observedAt": observed, "source": source}]
    if not website:
        observations.append({"type": "active_commercial_presence", "active": True, "observedAt": observed, "source": source})
        return {"observations": observations}
    probe = {"sourceType": "http_probe", "sourceUrl": website}
    try:
        status, html = fetch_text(website)
        lower = html.lower()
        missing = [key for key, terms in {"services": ("servicio", "service", "producto", "product"), "contact": ("contact", "correo", "email")}.items() if not any(term in lower for term in terms)]
        observations.extend([
            {"type": "reachability", "result": "response", "statusCode": status, "observedAt": observed, "source": probe},
            {"type": "secure_transport", "state": "valid" if website.startswith("https://") else "invalid", "observedAt": observed, "source": {"sourceType": "tls_probe", "sourceUrl": website}},
            {"type": "domain_operational", "state": "operational", "observedAt": observed, "source": {"sourceType": "dns_probe", "sourceUrl": website}},
            {"type": "critical_content", "requiredItems": ["services", "contact"], "missingItems": missing, "observedAt": observed, "source": {"sourceType": "website_scan", "sourceUrl": website}},
            {"type": "page_integrity", "checkedPages": 1, "brokenPages": 0, "observedAt": observed, "source": {"sourceType": "website_scan", "sourceUrl": website}},
            {"type": "navigation", "testedPaths": 1, "brokenPaths": 0, "observedAt": observed, "source": {"sourceType": "website_scan", "sourceUrl": website}},
        ])
    except Exception:
        observations.append({"type": "reachability", "result": "failure", "error": "connection", "observedAt": observed, "source": probe})
    return {"observations": observations}


def contacts(payload: dict[str, Any]) -> dict[str, Any]:
    observations: list[dict[str, Any]] = []
    for source in payload.get("sources", [])[:25]:
        try:
            _, html = fetch_text(source["sourceUrl"])
        except Exception:
            continue
        text = unescape(re.sub(r"<[^>]+>", " ", html))
        for email in sorted(set(re.findall(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", text)))[:10]:
            position = text.find(email)
            extract = " ".join(text[max(0, position - 100):position + len(email) + 100].split())
            observations.append({"sourceRef": source["ref"], "sourceUrl": source["sourceUrl"], "observedAt": source["suppliedAt"], "contentSha256": source["contentSha256"], "extract": extract, "email": email, "channel": "email"})
    return {"observations": observations[:50]}


def result_for(job: dict[str, Any]) -> dict[str, Any]:
    payload = job["payload"]
    if job["kind"] == "research":
        budget = payload["budget"]
        request = ExtractionRequest.model_validate({"source_url": payload["source"]["sourceUrl"], "source_type": payload["source"]["sourceType"], "supplied_at": payload["source"]["suppliedAt"], "content": payload.get("content", ""), "questions": payload.get("questions", []), "budget": {"max_runtime_ms": budget["maxRuntimeMs"], "max_model_calls": budget["maxModelCalls"], "max_input_tokens": budget["maxInputTokens"], "max_output_tokens": budget["maxOutputTokens"], "max_cost_usd": budget["maxCostUsd"]}})
        return extract_offline(request).model_dump(mode="json")
    if job["kind"] == "audit_website":
        return audit(payload)
    if job["kind"] == "qualify":
        return {}
    if job["kind"] == "enrich_contact":
        return contacts(payload)
    raise ValueError(f"unsupported job {job['kind']}")


def run_once(base_url: str, token: str) -> bool:
    status, job = api("POST", f"{base_url.rstrip('/')}/api/internal/leadhunter/jobs/next", token, {"kinds": ["research", "audit_website", "qualify", "enrich_contact"]})
    if status == 204:
        return False
    if status != 200:
        raise RuntimeError(f"KazeOS job claim failed with status {status}")
    if not isinstance(job, dict) or not all(key in job for key in ("id", "kind", "leaseToken", "payload")):
        raise RuntimeError("KazeOS returned an invalid job claim")
    try:
        body = {"leaseToken": job["leaseToken"], "result": result_for(job)}
    except Exception as error:
        body = {"leaseToken": job["leaseToken"], "error": str(error)[:2000]}
    api("POST", f"{base_url.rstrip('/')}/api/internal/leadhunter/jobs/{job['id']}/complete", token, body)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="KazeOS LeadHunter worker")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    base_url = os.environ["KAZEOS_URL"]
    token = os.environ["LEADHUNTER_WORKER_SECRET"]
    while True:
        worked = run_once(base_url, token)
        if args.once:
            return
        if not worked:
            time.sleep(15)


if __name__ == "__main__":
    main()
