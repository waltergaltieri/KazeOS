from __future__ import annotations

import email
from pathlib import Path

from leadhunter_worker.mail_transport import GmailMailTransport, dispatch_due_mail


class FakeSMTP:
    sent: list[object] = []
    logins: list[tuple[str, str]] = []

    def __init__(self, host: str, port: int, timeout: int) -> None:
        assert (host, port, timeout) == ("smtp.gmail.com", 465, 30)

    def __enter__(self) -> "FakeSMTP":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def login(self, user: str, password: str) -> None:
        self.logins.append((user, password))

    def send_message(self, message: object) -> None:
        self.sent.append(message)


def test_dispatch_pacing_survives_restart_and_skips_claim(tmp_path: Path) -> None:
    path = tmp_path / "paced.sqlite3"
    transport = GmailMailTransport("quime@example.com", "app-password", path)
    assert transport.reserve_dispatch_slot(432, now=1_000)
    restarted = GmailMailTransport("quime@example.com", "app-password", path)
    assert not restarted.reserve_dispatch_slot(432, now=1_431)
    assert restarted.reserve_dispatch_slot(432, now=1_432)
    # A late cycle reserves from now; unused capacity is never accumulated.
    assert restarted.reserve_dispatch_slot(432, now=5_000)
    assert not transport.reserve_dispatch_slot(432, now=5_001)
    assert not transport.reserve_dispatch_slot(432, now=999)


def test_paced_dispatch_claims_one_and_blocks_the_next_cycle(tmp_path: Path) -> None:
    transport = GmailMailTransport("quime@example.com", "app-password", tmp_path / "mail.sqlite3")
    claims = []
    def api(method: str, url: str, token: str, body: dict[str, object]) -> tuple[int, object]:
        claims.append(body)
        return 200, {"commands": []}
    assert dispatch_due_mail("https://example.com", "secret", transport, api=api, interval_seconds=432) == 0
    assert dispatch_due_mail("https://example.com", "secret", transport, api=api, interval_seconds=432) == 0
    assert claims == [{"limit": 1}]


class BaselineIMAP:
    def __init__(self, host: str, port: int) -> None:
        assert (host, port) == ("imap.gmail.com", 993)

    def __enter__(self) -> "BaselineIMAP":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def login(self, user: str, password: str) -> None:
        assert (user, password) == ("quime@example.com", "app-password")

    def select(self, mailbox: str, readonly: bool) -> tuple[str, list[bytes]]:
        assert (mailbox, readonly) == ("INBOX", True)
        return "OK", [b"500"]

    def uid(self, command: str, *_args: object) -> tuple[str, list[bytes]]:
        assert command == "search"
        return "OK", [b"498 499 500"]


def test_gmail_transport_sends_plain_text_once_per_idempotency_key(tmp_path: Path) -> None:
    FakeSMTP.sent.clear()
    FakeSMTP.logins.clear()
    transport = GmailMailTransport(
        address="quime@example.com",
        app_password="app-password",
        state_path=tmp_path / "mail.sqlite3",
        smtp_factory=FakeSMTP,
    )
    command = {
        "outboxId": "11111111-1111-4111-8111-111111111111",
        "recipient": "ventas@acme.com",
        "subject": "Una idea para Acme",
        "body": "Hola,\n\n¿Conversamos?",
        "idempotencyKey": "same-command",
    }

    first = transport.send(command)
    second = transport.send(command)

    assert first == second
    assert first.startswith("<kazeos.")
    assert first.endswith("@example.com>")
    assert len(FakeSMTP.sent) == 1
    message = FakeSMTP.sent[0]
    assert message["To"] == "ventas@acme.com"  # type: ignore[index]
    assert message["Subject"] == "Una idea para Acme"  # type: ignore[index]
    assert message.get_content().strip() == "Hola,\n\n¿Conversamos?"  # type: ignore[attr-defined]


def test_dispatch_claims_sends_and_settles_each_command(tmp_path: Path) -> None:
    FakeSMTP.sent.clear()
    calls: list[tuple[str, str, str, dict[str, object]]] = []

    def api(method: str, url: str, token: str, body: dict[str, object]) -> tuple[int, object]:
        calls.append((method, url, token, body))
        if url.endswith("/claim"):
            return 200, {"commands": [{
                "outboxId": "11111111-1111-4111-8111-111111111111",
                "recipient": "ventas@acme.com",
                "subject": "Asunto",
                "body": "Mensaje",
                "dueAt": "2026-10-02T12:00:00Z",
                "idempotencyKey": "command-1",
            }]}
        return 200, {"settled": True}

    transport = GmailMailTransport(
        "quime@example.com",
        "app-password",
        tmp_path / "mail.sqlite3",
        smtp_factory=FakeSMTP,
    )

    assert dispatch_due_mail("https://kazeos.example", "transport-secret", transport, api=api) == 1
    assert calls[0][1].endswith("/api/public/leadhunter/mail/claim")
    assert calls[1][1].endswith("/api/public/leadhunter/mail/settle")
    assert calls[1][3]["result"] == "accepted"
    assert calls[1][3]["providerMessageId"].startswith("<kazeos.")


def test_reply_parser_links_in_reply_to_with_a_sent_message(tmp_path: Path) -> None:
    transport = GmailMailTransport(
        "quime@example.com",
        "app-password",
        tmp_path / "mail.sqlite3",
        smtp_factory=FakeSMTP,
    )
    provider_id = transport.remember_sent("command-2")
    message = email.message_from_string(
        "From: prospect@example.com\n"
        "Subject: Re: propuesta\n"
        f"In-Reply-To: {provider_id}\n"
        f"References: {provider_id}\n\n"
        "Gracias, contame más."
    )

    assert transport.classify_event(message) == ("replied", provider_id)


def test_bounce_parser_links_original_message_id(tmp_path: Path) -> None:
    transport = GmailMailTransport(
        "quime@example.com",
        "app-password",
        tmp_path / "mail.sqlite3",
        smtp_factory=FakeSMTP,
    )
    provider_id = transport.remember_sent("command-3")
    message = email.message_from_string(
        "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>\n"
        "Subject: Delivery Status Notification (Failure)\n\n"
        f"Original-Message-ID: {provider_id}\n"
    )

    assert transport.classify_event(message) == ("bounced", provider_id)


def test_first_poll_sets_baseline_without_fetching_historical_mail(tmp_path: Path) -> None:
    transport = GmailMailTransport(
        "quime@example.com",
        "app-password",
        tmp_path / "mail.sqlite3",
        smtp_factory=FakeSMTP,
        imap_factory=BaselineIMAP,
    )

    events, highest_uid = transport.poll_events()

    assert events == []
    assert highest_uid == 500
