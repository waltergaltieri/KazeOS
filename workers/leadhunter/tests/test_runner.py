from __future__ import annotations

import pytest

from leadhunter_worker import runner


def test_run_once_rejects_server_errors_before_reading_a_job(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runner, "api", lambda *_args, **_kwargs: (500, {"error": "Job claim failed"}))

    with pytest.raises(RuntimeError, match="status 500"):
        runner.run_once("https://kazeos.example", "secret")


def test_run_once_returns_false_when_no_job_is_available(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runner, "api", lambda *_args, **_kwargs: (204, None))

    assert runner.run_once("https://kazeos.example", "secret") is False
