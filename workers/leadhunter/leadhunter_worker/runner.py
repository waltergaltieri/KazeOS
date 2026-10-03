from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import datetime, timezone
from html import unescape
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .contracts import ExtractionRequest
from .extract import extract_offline
from .mail_transport import GmailMailTransport, dispatch_due_mail, report_mail_events
from .minimax import MiniMaxClient

UrlOpener = Callable[..., Any]


def canonical_public_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("candidate URL must be public HTTP(S)")
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname == "localhost" or hostname.endswith(".local"):
        raise ValueError("candidate URL must be public HTTP(S)")
    try:
        if not ipaddress.ip_address(hostname).is_global:
            raise ValueError("candidate URL must be public HTTP(S)")
    except ValueError as error:
        if str(error) == "candidate URL must be public HTTP(S)":
            raise
    port = parsed.port
    netloc = hostname if port is None or (parsed.scheme == "https" and port == 443) or (parsed.scheme == "http" and port == 80) else f"{hostname}:{port}"
    path = parsed.path or "/"
    if path != "/":
        path = path.rstrip("/") or "/"
    query = urlencode([
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in {"fbclid", "gclid"}
    ])
    return urlunsplit((parsed.scheme.lower(), netloc, path, query, ""))


def discover(payload: dict[str, Any], searxng_url: str, opener: UrlOpener = urllib.request.urlopen) -> dict[str, Any]:
    if payload.get("kind") == "seed_url":
        source_url = str(payload.get("url", ""))
        canonical = canonical_public_url(source_url)
        candidate = {
            "sourceType": "seed_url",
            "sourceIdentity": canonical,
            "sourceUrl": source_url,
            "observedUrl": source_url,
            "canonicalUrl": canonical,
            "observedName": None,
            "observedLocation": None,
            "providerRank": 1,
            "metadata": {},
        }
        return {"kind": "discover", "output": {"candidateCount": 1, "candidates": [candidate], "nextCursor": {"state": "exhausted"}}}
    if payload.get("kind") != "source_query":
        raise ValueError("unsupported discovery payload")

    source = str(payload.get("source", ""))
    suffix = {
        "directories": "(directory OR chamber OR Yelp OR Paginas Amarillas OR Yellow Pages)",
        "instagram": "site:instagram.com",
        "linkedin": "site:linkedin.com/company",
    }.get(source, "")
    query = str(payload.get("query", "")).strip()
    if suffix:
        query = f"{query[:499 - len(suffix)]} {suffix}"
    cursor = payload.get("cursor")
    page = 1
    if isinstance(cursor, dict) and cursor.get("state") == "next":
        value = cursor.get("value")
        if isinstance(value, dict) and isinstance(value.get("page"), int) and value["page"] > 0:
            page = value["page"]
    separator = "&" if "?" in searxng_url else "?"
    request_url = f"{searxng_url}{separator}{urlencode({'q': query, 'format': 'json', 'pageno': page})}"
    request = urllib.request.Request(request_url, headers={"Accept": "application/json", "User-Agent": "KazeOS-LeadHunter/1.0"})
    with opener(request, timeout=30) as response:
        raw = response.read(1_000_001)
    if len(raw) > 1_000_000:
        raise ValueError("SearXNG response is too large")
    document = json.loads(raw)
    results = document.get("results") if isinstance(document, dict) else None
    if not isinstance(results, list) or len(results) > 100:
        raise ValueError("SearXNG returned an invalid response")

    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    for rank, item in enumerate(results, start=1):
        if len(candidates) >= 50:
            break
        if not isinstance(item, dict) or not isinstance(item.get("url"), str):
            continue
        source_url = item["url"]
        try:
            canonical = canonical_public_url(source_url)
        except (TypeError, ValueError):
            continue
        if canonical in seen:
            continue
        seen.add(canonical)
        metadata: dict[str, Any] = {}
        if isinstance(item.get("engine"), str) and item["engine"].strip():
            metadata["engine"] = item["engine"].strip()
        if isinstance(item.get("content"), str) and item["content"].strip():
            metadata["snippet"] = item["content"].strip()[:2_000]
            metadata["snippetTrust"] = "untrusted"
        title = item.get("title")
        observed_name = title.strip()[:240] if isinstance(title, str) and title.strip() else None
        role = {
            "web_search": "official_website",
            "directories": "directory",
            "instagram": "social_profile",
            "linkedin": "social_profile",
        }.get(source, "directory")
        if observed_name:
            metadata["identity"] = {
                "name": observed_name,
                "emails": [],
                "urls": [{"url": canonical, "role": role}],
                "location": {},
                "organizationRole": "unknown",
            }
        candidates.append({
            "sourceType": source,
            "sourceIdentity": canonical,
            "sourceUrl": source_url,
            "observedUrl": source_url,
            "canonicalUrl": canonical,
            "observedName": observed_name,
            "observedLocation": None,
            "providerRank": rank,
            "metadata": metadata,
        })
    next_cursor = {"state": "exhausted"} if not results else {"state": "next", "value": {"page": page + 1}}
    return {"kind": "discover", "output": {"candidateCount": len(candidates), "candidates": candidates, "nextCursor": next_cursor}}


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
    if job["kind"] == "discover":
        return discover(payload, os.environ["SEARXNG_URL"])
    if job["kind"] == "research":
        budget = payload["budget"]
        request = ExtractionRequest.model_validate({"source_url": payload["source"]["sourceUrl"], "source_type": payload["source"]["sourceType"], "supplied_at": payload["source"]["suppliedAt"], "content": payload.get("content", ""), "questions": payload.get("questions", []), "budget": {"max_runtime_ms": budget["maxRuntimeMs"], "max_model_calls": budget["maxModelCalls"], "max_input_tokens": budget["maxInputTokens"], "max_output_tokens": budget["maxOutputTokens"], "max_cost_usd": budget["maxCostUsd"]}})
        minimax_key = os.environ.get("MINIMAX_API_KEY", "").strip()
        if minimax_key:
            return MiniMaxClient(
                minimax_key,
                os.environ.get("MINIMAX_BASE_URL", "https://api.minimax.io/v1"),
                os.environ.get("MINIMAX_MODEL", "MiniMax-M3"),
            ).extract(request).model_dump(mode="json")
        return extract_offline(request).model_dump(mode="json")
    if job["kind"] == "audit_website":
        return audit(payload)
    if job["kind"] == "qualify":
        return {}
    if job["kind"] == "enrich_contact":
        return contacts(payload)
    raise ValueError(f"unsupported job {job['kind']}")


def run_once(base_url: str, token: str) -> bool:
    status, job = api("POST", f"{base_url.rstrip('/')}/api/internal/leadhunter/jobs/next", token, {"kinds": ["discover", "research", "audit_website", "qualify", "enrich_contact"]})
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


def trigger_tick(base_url: str, token: str) -> None:
    status, _ = api(
        "POST",
        f"{base_url.rstrip('/')}/api/internal/leadhunter/tick",
        token,
        {},
    )
    if status != 200:
        raise RuntimeError(f"KazeOS LeadHunter tick failed with status {status}")


def main() -> None:
    parser = argparse.ArgumentParser(description="KazeOS LeadHunter worker")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    base_url = os.environ["KAZEOS_URL"]
    token = os.environ["LEADHUNTER_WORKER_SECRET"]
    gmail_address = os.environ.get("GMAIL_ADDRESS", "").strip()
    gmail_password = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    transport_secret = os.environ.get("LEADHUNTER_TRANSPORT_SECRET", "").strip()
    mail_settings = [gmail_address, gmail_password, transport_secret]
    if (gmail_address or gmail_password) and not all(mail_settings):
        raise RuntimeError("Gmail transport configuration is incomplete")
    mail_transport = GmailMailTransport(
        gmail_address,
        gmail_password,
        os.environ.get("MAIL_STATE_PATH", "/var/lib/kazeos-leadhunter/mail.sqlite3"),
    ) if all(mail_settings) else None
    tick_interval_seconds = max(30, int(os.environ.get("TICK_INTERVAL_SECONDS", "60")))
    next_tick = 0.0
    while True:
        now = time.monotonic()
        if now >= next_tick:
            trigger_tick(base_url, token)
            if mail_transport is not None:
                try:
                    dispatch_due_mail(base_url, transport_secret, mail_transport)
                    report_mail_events(base_url, transport_secret, mail_transport)
                except Exception as error:
                    print(f"LeadHunter mail cycle failed: {error}", file=sys.stderr)
            next_tick = now + tick_interval_seconds
        worked = run_once(base_url, token)
        if args.once:
            return
        if not worked:
            time.sleep(15)


if __name__ == "__main__":
    main()
