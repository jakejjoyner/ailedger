"""Session-open today-state digest (ai-1q1).

The digest is the primary lever behind Jo auto-loading Pasha's context on
session-open: it pulls addressable hails via the same 6-gate filter the
SPA uses and hands them to Jo as ``[SESSION CONTEXT]`` ahead of the first
turn. A later "what's the latest?" question can then be answered from
loaded state instead of bouncing the ask back at the contractor.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app import jo as jo_module
from app.config import Config
from app.jo import JoSessionManager


def _write_hail(box: Path, name: str, body: str = "To: pasha\n\nhi\n") -> None:
    box.mkdir(parents=True, exist_ok=True)
    (box / name).write_text(body)


@pytest.fixture()
def cfg(tmp_path: Path) -> Config:
    box = tmp_path / "publish"
    docs = box / "docs"
    read = tmp_path / "read"
    box.mkdir()
    docs.mkdir()
    read.mkdir()
    return Config(
        slug="pasha",
        jwt_secret="0" * 64,
        publish_box=box,
        activation_date="20260101",
        docs_dir=docs,
        read_dir=read,
        dash_origins=(),
        bind_host="127.0.0.1",
        bind_port=7777,
    )


@pytest.fixture()
def patch_load_config(monkeypatch: pytest.MonkeyPatch, cfg: Config):
    """Make `load_config()` (called inside _build_today_digest) return our fixture cfg."""
    # config.load_config is imported lazily inside the method; patch the
    # canonical import path.
    monkeypatch.setattr(
        "app.config.load_config",
        lambda: cfg,
    )
    return cfg


def _fname_for(dt: datetime, sender: str, subject: str) -> str:
    """Filename that matches _FNAME_RE and a chosen UTC timestamp."""
    return f"{dt.strftime('%Y%m%d-%H%M%S')}-from-{sender}-{subject}.md"


def test_digest_returns_none_on_empty_inbox(patch_load_config: Config) -> None:
    mgr = JoSessionManager()
    assert mgr._build_today_digest() is None


def test_digest_includes_recent_item(patch_load_config: Config) -> None:
    cfg = patch_load_config
    recent = datetime.now(timezone.utc) - timedelta(hours=2)
    _write_hail(cfg.publish_box, _fname_for(recent, "john", "progress-update"))
    mgr = JoSessionManager()
    block = mgr._build_today_digest()
    assert block is not None
    assert "[SESSION CONTEXT" in block
    assert "from john: progress update" in block
    assert "UNREAD" in block
    # Path reference for on-demand Read
    assert str(cfg.publish_box) in block


def test_digest_excludes_items_older_than_window(patch_load_config: Config) -> None:
    cfg = patch_load_config
    stale = datetime.now(timezone.utc) - timedelta(hours=48)
    _write_hail(cfg.publish_box, _fname_for(stale, "john", "old-news"))
    mgr = JoSessionManager()
    assert mgr._build_today_digest() is None


def test_digest_filters_mix_of_recent_and_stale(patch_load_config: Config) -> None:
    cfg = patch_load_config
    stale = datetime.now(timezone.utc) - timedelta(hours=30)
    recent = datetime.now(timezone.utc) - timedelta(hours=3)
    _write_hail(cfg.publish_box, _fname_for(stale, "john", "old-news"))
    _write_hail(cfg.publish_box, _fname_for(recent, "angela", "signal-just-in"))
    mgr = JoSessionManager()
    block = mgr._build_today_digest()
    assert block is not None
    assert "signal just in" in block
    assert "old news" not in block


def test_digest_caps_at_max_items(patch_load_config: Config) -> None:
    cfg = patch_load_config
    now = datetime.now(timezone.utc)
    # Seed more than the cap, each a distinct timestamp a minute apart.
    for i in range(JoSessionManager._TODAY_DIGEST_MAX_ITEMS + 5):
        dt = now - timedelta(minutes=i + 1)
        _write_hail(cfg.publish_box, _fname_for(dt, "john", f"item-{i:02d}"))
    mgr = JoSessionManager()
    block = mgr._build_today_digest()
    assert block is not None
    # Newest first → oldest truncated. item-00 should appear, item-24 shouldn't.
    assert "item-00" in block
    assert f"item-{JoSessionManager._TODAY_DIGEST_MAX_ITEMS + 4:02d}" not in block
    # Count bullets: exactly the cap.
    bullet_count = sum(1 for line in block.splitlines() if line.startswith("- "))
    assert bullet_count == JoSessionManager._TODAY_DIGEST_MAX_ITEMS


def test_digest_marks_read_state(patch_load_config: Config, cfg: Config) -> None:
    recent = datetime.now(timezone.utc) - timedelta(hours=1)
    fname = _fname_for(recent, "john", "seen-already")
    _write_hail(cfg.publish_box, fname)
    # Simulate the SPA having marked this hail read.
    (cfg.read_dir / f"{fname}.read").touch()
    mgr = JoSessionManager()
    block = mgr._build_today_digest()
    assert block is not None
    assert "[read]" in block
    assert "UNREAD" not in block


def test_digest_tolerates_missing_publish_box(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    """A half-configured env should downgrade to None, not crash session-open."""
    bad_cfg_err = RuntimeError("CONTRACTOR_PUBLISH_BOX not set")

    def _raise() -> Config:
        raise bad_cfg_err

    monkeypatch.setattr("app.config.load_config", _raise)
    mgr = JoSessionManager()
    assert mgr._build_today_digest() is None


def test_digest_excludes_non_addressable_hails(patch_load_config: Config) -> None:
    """The 6-gate filter runs via list_inbox — hails addressed elsewhere or
    self-sent should not leak into Jo's loaded state."""
    cfg = patch_load_config
    recent = datetime.now(timezone.utc) - timedelta(hours=1)
    # Addressed to another contractor (gate 6 fails)
    _write_hail(
        cfg.publish_box,
        _fname_for(recent, "john", "for-acme"),
        body="To: acme\n\nhi\n",
    )
    # Self-message (gate 4 fails)
    _write_hail(
        cfg.publish_box,
        _fname_for(recent, "pasha", "note-to-self"),
        body="To: pasha\n\nnote\n",
    )
    # Cross-agent coordination (gate 3 fails)
    _write_hail(
        cfg.publish_box,
        _fname_for(recent, "john", "to-jo-coordinate"),
        body="To: pasha\n\nsee above\n",
    )
    mgr = JoSessionManager()
    assert mgr._build_today_digest() is None


def test_digest_skip_logs_warning_but_does_not_raise(
    patch_load_config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unexpected failure in list_inbox should downgrade to None so
    session-open keeps working even if the digest layer has a bug."""

    def _blow_up(_cfg):
        raise RuntimeError("simulated inbox failure")

    monkeypatch.setattr("app.inbox.list_inbox", _blow_up)
    mgr = JoSessionManager()
    assert mgr._build_today_digest() is None
