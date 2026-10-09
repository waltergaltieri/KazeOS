from __future__ import annotations

import argparse
import hashlib
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
from .mail_transport import GmailMailTransport, dispatch_due_mail, report_mail_events
from .scrapegraph import ScrapeGraphResearch

UrlOpener = Callable[..., Any]


def business_source_role(url: str) -> str | None:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    def belongs(domains: tuple[str, ...]) -> bool:
        return any(host == domain or host.endswith("." + domain) for domain in domains)
    if belongs(("wa.me", "whatsapp.com", "youtube.com", "youtu.be", "tiktok.com", "pinterest.com")):
        return None
    if belongs(("instagram.com", "facebook.com", "linkedin.com")):
        path = parsed.path.strip("/")
        if not path or re.search(r"(^|/)(p|reel|reels|posts|watch|login|share|search|explore|jobs|in)(/|$)", path):
            return None
        return "social_profile"
    if belongs(("yelp.com", "bbb.org", "paginasamarillas.com.ar", "yellowpages.com")):
        return "directory"
    if re.search(r"\.(pdf|jpg|png|zip)$", parsed.path, re.I):
        return None
    return "official_website"


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
            "metadata": {"identity": {"name": None, "emails": [],
                "urls": [{"url": canonical, "role": business_source_role(canonical) or "directory"}],
                "location": {}, "organizationRole": "unknown"}},
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
    country = {"AR": "Argentina", "US": "United States"}.get(payload.get("country"), payload.get("country"))
    for term in (payload.get("industry"), payload.get("region"), country):
        if isinstance(term, str) and term.strip() and term.casefold() not in query.casefold():
            query += " " + term.strip()
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
        role = business_source_role(canonical)
        if role is None:
            continue
        if source == "directories" and role == "official_website":
            role = "directory"
        if source in {"instagram", "linkedin"} and role != "social_profile":
            continue
        identity_key = urlsplit(canonical).netloc.removeprefix("www.") if role == "official_website" else canonical
        if identity_key in seen:
            continue
        seen.add(identity_key)
        metadata: dict[str, Any] = {}
        if isinstance(item.get("engine"), str) and item["engine"].strip():
            metadata["engine"] = item["engine"].strip()
        if isinstance(item.get("content"), str) and item["content"].strip():
            metadata["snippet"] = item["content"].strip()[:2_000]
            metadata["snippetTrust"] = "untrusted"
        title = item.get("title")
        observed_name = title.strip()[:240] if isinstance(title, str) and title.strip() else None
        if observed_name:
            segments = re.split(r"\s+[|–—-]\s+", observed_name)
            observed_name = " - ".join(segment for segment in segments if segment.casefold() not in {"contacto", "contact", "inicio", "home", "instagram", "linkedin"}) or observed_name
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
            "sourceIdentity": identity_key,
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
        with urllib.request.urlopen(request, timeout=310) as response:
            raw = response.read(1_000_000)
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read(100_000)
        return error.code, json.loads(raw) if raw else None


def fetch_text(url: str) -> tuple[int, str, str]:
    request = urllib.request.Request(url, headers={"User-Agent": "KazeOS-LeadHunter/1.0", "Accept": "text/html"})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read(1_000_000)
        return response.status, raw.decode(response.headers.get_content_charset() or "utf-8", errors="replace"), response.geturl()


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
        status, _html, final_url = fetch_text(website)
        observations.extend([
            {"type": "reachability", "result": "response", "statusCode": status, "observedAt": observed, "source": probe},
            {"type": "secure_transport", "state": "valid" if final_url.startswith("https://") else "invalid", "observedAt": observed, "source": {"sourceType": "tls_probe", "sourceUrl": website}},
            {"type": "domain_operational", "state": "operational", "observedAt": observed, "source": {"sourceType": "dns_probe", "sourceUrl": website}},
        ])
    except Exception:
        observations.append({"type": "reachability", "result": "failure", "error": "connection", "observedAt": observed, "source": probe})
    from .visual_audit import visual_audit
    observations.append(visual_audit(website, observed))
    return {"observations": observations}


def contacts(payload: dict[str, Any]) -> dict[str, Any]:
    observations: list[dict[str, Any]] = []
    for source in payload.get("sources", [])[:25]:
        text = source.get("content")
        if not isinstance(text, str):
            # Older jobs lack a captured page. Do not invent provenance for a new fetch.
            continue
        if hashlib.sha256(text.encode("utf-8")).hexdigest() != source["contentSha256"]:
            raise ValueError("contact snapshot hash mismatch")
        for email in sorted(set(re.findall(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", text)))[:10]:
            position = text.find(email)
            if re.search(r"(?:\bej(?:emplo)?|\bexample|e\.g\.)\s*[:(]?\s*$", text[max(0, position - 40):position], re.I):
                continue
            if re.fullmatch(r"(?:tu|nombre|your|name|usuario|user)@(?:email|example|ejemplo)\.com", email, re.I):
                continue
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
            return ScrapeGraphResearch(
                minimax_key,
                os.environ.get("MINIMAX_BASE_URL", "https://api.minimax.io/v1"),
                os.environ.get("MINIMAX_MODEL", "MiniMax-M3"),
            ).extract(request).model_dump(mode="json")
        raise RuntimeError("MINIMAX_API_KEY is required for live research")
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
    status, _ = api("POST", f"{base_url.rstrip('/')}/api/internal/leadhunter/jobs/{job['id']}/complete", token, body)
    if status != 200:
        raise RuntimeError(f"KazeOS job completion failed with status {status}")
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
