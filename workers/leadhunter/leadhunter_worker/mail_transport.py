from __future__ import annotations

import email
import hashlib
import imaplib
import json
import re
import smtplib
import sqlite3
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from email.message import EmailMessage, Message
from email.utils import format_datetime, parseaddr, parsedate_to_datetime
from pathlib import Path
from typing import Any

MailApi = Callable[[str, str, str, dict[str, Any]], tuple[int, Any]]


def _clean_header(value: object, name: str, maximum: int) -> str:
    text = str(value or "").strip()
    if not text or len(text) > maximum or "\r" in text or "\n" in text:
        raise ValueError(f"invalid {name}")
    return text


class GmailMailTransport:
    def __init__(
        self,
        address: str,
        app_password: str,
        state_path: str | Path,
        smtp_factory: Callable[..., Any] = smtplib.SMTP_SSL,
        imap_factory: Callable[..., Any] = imaplib.IMAP4_SSL,
    ) -> None:
        _, normalized = parseaddr(address)
        if normalized.casefold() != address.strip().casefold() or "@" not in normalized:
            raise ValueError("invalid Gmail address")
        password = app_password.replace(" ", "").strip()
        if not password:
            raise ValueError("Gmail app password is required")
        self.address = normalized
        self._password = password
        self._state_path = Path(state_path)
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._smtp_factory = smtp_factory
        self._imap_factory = imap_factory
        self._initialize_state()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._state_path)
        connection.execute("pragma journal_mode=wal")
        return connection

    def _initialize_state(self) -> None:
        with self._connect() as connection:
            connection.execute(
                "create table if not exists sent ("
                "idempotency_key text primary key, provider_message_id text not null unique, "
                "sent_at text not null)"
            )
            connection.execute(
                "create table if not exists state (key text primary key, value text not null)"
            )

    def _provider_message_id(self, idempotency_key: str) -> str:
        digest = hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()
        domain = self.address.rsplit("@", 1)[1].lower()
        return f"<kazeos.{digest}@{domain}>"

    def reserve_dispatch_slot(self, interval_seconds: int, now: float | None = None) -> bool:
        """Persist the mailbox slot before claiming; restarts never accumulate capacity."""
        if interval_seconds <= 0:
            raise ValueError("mail interval must be positive")
        current = datetime.now(timezone.utc).timestamp() if now is None else now
        key = f"dispatch_next:{self.address.casefold()}"
        with self._connect() as connection:
            connection.execute("begin immediate")
            row = connection.execute("select value from state where key=?", (key,)).fetchone()
            if row and current < float(row[0]):
                return False
            connection.execute(
                "insert into state(key,value) values(?,?) on conflict(key) do update set value=excluded.value",
                (key, str(current + interval_seconds)),
            )
        return True

    def remember_sent(self, idempotency_key: str) -> str:
        key = _clean_header(idempotency_key, "idempotency key", 500)
        provider_id = self._provider_message_id(key)
        with self._connect() as connection:
            connection.execute(
                "insert or ignore into sent (idempotency_key,provider_message_id,sent_at) values (?,?,?)",
                (key, provider_id, datetime.now(timezone.utc).isoformat()),
            )
        return provider_id

    def send(self, command: Mapping[str, object]) -> str:
        key = _clean_header(command.get("idempotencyKey"), "idempotency key", 500)
        with self._connect() as connection:
            row = connection.execute(
                "select provider_message_id from sent where idempotency_key=?",
                (key,),
            ).fetchone()
        if row:
            return str(row[0])

        recipient = _clean_header(command.get("recipient"), "recipient", 320)
        _, parsed_recipient = parseaddr(recipient)
        if parsed_recipient.casefold() != recipient.casefold() or "@" not in recipient:
            raise ValueError("invalid recipient")
        subject = _clean_header(command.get("subject"), "subject", 500)
        body = str(command.get("body") or "")
        if not body.strip() or len(body) > 100_000:
            raise ValueError("invalid body")

        provider_id = self._provider_message_id(key)
        message = EmailMessage()
        message["From"] = self.address
        message["To"] = recipient
        message["Subject"] = subject
        message["Date"] = format_datetime(datetime.now(timezone.utc))
        message["Message-ID"] = provider_id
        message["X-KazeOS-Outbox-ID"] = _clean_header(command.get("outboxId"), "outbox id", 100)
        message.set_content(body, subtype="plain", charset="utf-8")

        with self._smtp_factory("smtp.gmail.com", 465, timeout=30) as smtp:
            smtp.login(self.address, self._password)
            smtp.send_message(message)
        self.remember_sent(key)
        return provider_id

    def _known_provider_ids(self) -> set[str]:
        with self._connect() as connection:
            return {
                str(row[0])
                for row in connection.execute("select provider_message_id from sent")
            }

    def classify_event(self, message: Message) -> tuple[str, str] | None:
        known = self._known_provider_ids()
        if not known:
            return None
        header_text = " ".join([
            str(message.get("In-Reply-To", "")),
            str(message.get("References", "")),
            str(message.get("Original-Message-ID", "")),
        ])
        body_parts: list[str] = []
        if message.is_multipart():
            for part in message.walk():
                if part.get_content_type() == "message/rfc822":
                    payload = part.get_payload()
                    if isinstance(payload, list):
                        body_parts.extend(str(item) for item in payload)
                elif part.get_content_type() == "text/plain":
                    try:
                        body_parts.append(part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace"))
                    except (AttributeError, UnicodeError):
                        pass
        else:
            payload = message.get_payload(decode=True)
            if isinstance(payload, bytes):
                body_parts.append(payload.decode(message.get_content_charset() or "utf-8", "replace"))
            else:
                body_parts.append(str(message.get_payload()))
        searchable = f"{header_text}\n{' '.join(body_parts)}"
        matched = next((provider_id for provider_id in known if provider_id in searchable), None)
        if not matched:
            return None
        sender = str(message.get("From", "")).casefold()
        subject = str(message.get("Subject", "")).casefold()
        bounced = (
            "mailer-daemon" in sender
            or "delivery status notification" in subject
            or "undeliver" in subject
            or message.get_content_type() == "multipart/report"
        )
        return ("bounced" if bounced else "replied", matched)

    def _last_uid(self) -> int:
        with self._connect() as connection:
            row = connection.execute("select value from state where key='gmail_last_uid'").fetchone()
        return int(row[0]) if row else 0

    def _store_last_uid(self, uid: int) -> None:
        with self._connect() as connection:
            connection.execute(
                "insert into state (key,value) values ('gmail_last_uid',?) "
                "on conflict(key) do update set value=excluded.value",
                (str(uid),),
            )

    def poll_events(self) -> tuple[list[tuple[str, str, str]], int]:
        last_uid = self._last_uid()
        events: list[tuple[str, str, str]] = []
        highest_uid = last_uid
        with self._imap_factory("imap.gmail.com", 993) as inbox:
            inbox.login(self.address, self._password)
            status, _ = inbox.select("INBOX", readonly=True)
            if status != "OK":
                raise RuntimeError("Gmail inbox could not be selected")
            status, data = inbox.uid("search", None, f"UID {last_uid + 1}:*")
            if status != "OK":
                raise RuntimeError("Gmail inbox search failed")
            raw_uids = data[0].split() if data and isinstance(data[0], bytes) else []
            if not self._known_provider_ids():
                if raw_uids:
                    highest_uid = max(int(raw_uid) for raw_uid in raw_uids)
                return events, highest_uid
            for raw_uid in raw_uids[-500:]:
                uid = int(raw_uid)
                highest_uid = max(highest_uid, uid)
                status, fetched = inbox.uid("fetch", raw_uid, "(RFC822)")
                if status != "OK" or not fetched:
                    continue
                raw_message = next(
                    (item[1] for item in fetched if isinstance(item, tuple) and isinstance(item[1], bytes)),
                    None,
                )
                if raw_message is None:
                    continue
                parsed = email.message_from_bytes(raw_message)
                classified = self.classify_event(parsed)
                if classified is None:
                    continue
                event, provider_id = classified
                try:
                    occurred = parsedate_to_datetime(str(parsed.get("Date", "")))
                    if occurred.tzinfo is None:
                        occurred = occurred.replace(tzinfo=timezone.utc)
                except (TypeError, ValueError):
                    occurred = datetime.now(timezone.utc)
                events.append((event, provider_id, occurred.isoformat()))
        return events, highest_uid

    def acknowledge_events(self, highest_uid: int) -> None:
        self._store_last_uid(highest_uid)


def dispatch_due_mail(
    base_url: str,
    transport_secret: str,
    transport: GmailMailTransport,
    limit: int = 10,
    api: MailApi | None = None,
    interval_seconds: int = 0,
) -> int:
    if interval_seconds > 0:
        if not transport.reserve_dispatch_slot(interval_seconds):
            return 0
        limit = 1
    if api is None:
        from .runner import api as request_api
        api = request_api
    root = base_url.rstrip("/")
    status, payload = api(
        "POST",
        f"{root}/api/public/leadhunter/mail/claim",
        transport_secret,
        {"limit": limit},
    )
    if status != 200 or not isinstance(payload, dict) or not isinstance(payload.get("commands"), list):
        raise RuntimeError(f"KazeOS mail claim failed with status {status}")
    if interval_seconds > 0 and len(payload["commands"]) > 1:
        raise RuntimeError("KazeOS exceeded the paced mail claim limit")
    sent = 0
    for raw_command in payload["commands"]:
        if not isinstance(raw_command, dict):
            continue
        outbox_id = str(raw_command.get("outboxId") or "")
        try:
            provider_id = transport.send(raw_command)
            settle = {
                "outboxId": outbox_id,
                "result": "accepted",
                "providerMessageId": provider_id,
            }
        except Exception as error:
            settle = {
                "outboxId": outbox_id,
                "result": "unknown",
                "error": str(error)[:1_000],
            }
        settle_status, _ = api(
            "POST",
            f"{root}/api/public/leadhunter/mail/settle",
            transport_secret,
            settle,
        )
        if settle_status != 200:
            raise RuntimeError(f"KazeOS mail settlement failed with status {settle_status}")
        if settle["result"] == "accepted":
            sent += 1
    return sent


def report_mail_events(
    base_url: str,
    transport_secret: str,
    transport: GmailMailTransport,
    api: MailApi | None = None,
) -> int:
    if api is None:
        from .runner import api as request_api
        api = request_api
    events, highest_uid = transport.poll_events()
    root = base_url.rstrip("/")
    for event, provider_id, occurred_at in events:
        status, _ = api(
            "POST",
            f"{root}/api/public/leadhunter/mail/events",
            transport_secret,
            {
                "providerMessageId": provider_id,
                "event": event,
                "occurredAt": occurred_at,
            },
        )
        if status != 200:
            raise RuntimeError(f"KazeOS mail event failed with status {status}")
    transport.acknowledge_events(highest_uid)
    return len(events)
