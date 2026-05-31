"""
Mullvad VPN + SOCKS5 proxy rotation for nba_api bulk fetches.

Provides IP rotation to prevent rate-limiting/banning from stats.nba.com
during large validation runs (~17K+ API calls).

Two rotation modes:
  1. VPN Reconnect: cycle through US cities via `mullvad reconnect` (~5-10s per rotation)
  2. SOCKS5 Multi-Exit: route through different Mullvad SOCKS5 proxies (instant, no reconnect)

Usage:
    from _shared import create_session, MullvadRotator

    rotator = MullvadRotator()
    rotator.connect()
    session = create_session(rotator)
    resp = session.get("https://stats.nba.com/stats/...")

Environment variables:
    MULLVAD_BATCH_SIZE     - requests per IP before proactive rotation (default: 300)
    MULLVAD_REQUEST_DELAY  - seconds between requests (default: 0.75)
    MULLVAD_RECONNECT_WAIT - seconds to wait after reconnect (default: 10)
    MULLVAD_MAX_RETRIES    - max retries per request (default: 3)
    MULLVAD_ROTATION_MODE  - 'vpn' | 'socks5' | 'hybrid' (default: 'hybrid')
    MULLVAD_LOCKDOWN       - enable kill switch (default: 'true')
    MULLVAD_CITIES         - comma-separated city codes (default: all 20 US cities)
    MULLVAD_SOCKS5_PROXIES - comma-separated SOCKS5 proxy URLs (optional)
    MULLVAD_LOG_FILE       - path to JSON log file (default: stderr)
"""

from __future__ import annotations

import json
import os
import random
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests

US_CITIES = [
    "atl", "bos", "chi", "dal", "den", "det", "hou", "lax",
    "mia", "mkc", "nyc", "phx", "qas", "rag", "sea", "sjc",
    "slc", "txc", "uyk", "was",
]

DEFAULT_BATCH_SIZE = 300
DEFAULT_REQUEST_DELAY = 0.75
DEFAULT_RECONNECT_WAIT = 10
DEFAULT_MAX_RETRIES = 3
DEFAULT_TIMEOUT = 60

NBA_HEADERS = {
    "Host": "stats.nba.com",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/145.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Referer": "https://www.nba.com/",
    "Origin": "https://www.nba.com",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
    "Sec-Ch-Ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
}


@dataclass
class RotationStats:
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    rotations: int = 0
    rate_limits_hit: int = 0
    timeouts: int = 0
    cities_used: list[str] = field(default_factory=list)
    ips_seen: list[str] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        elapsed = time.time() - self.started_at
        return {
            "total_requests": self.total_requests,
            "successful_requests": self.successful_requests,
            "failed_requests": self.failed_requests,
            "rotations": self.rotations,
            "rate_limits_hit": self.rate_limits_hit,
            "timeouts": self.timeouts,
            "cities_used": self.cities_used,
            "unique_ips": len(set(self.ips_seen)),
            "elapsed_seconds": round(elapsed, 1),
            "requests_per_second": round(self.total_requests / max(elapsed, 1), 2),
        }


def _log(msg: str, level: str = "info", **kwargs: Any) -> None:
    entry = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "level": level,
        "msg": msg,
        **kwargs,
    }
    log_file = os.environ.get("MULLVAD_LOG_FILE")
    if log_file:
        with open(log_file, "a") as f:
            f.write(json.dumps(entry) + "\n")
    else:
        print(json.dumps(entry), file=sys.stderr)


def _run_mullvad(*args: str, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    cmd = ["mullvad", *args]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def _get_env_int(key: str, default: int) -> int:
    val = os.environ.get(key)
    return int(val) if val else default


def _get_env_str(key: str, default: str) -> str:
    return os.environ.get(key, default)


def _get_env_bool(key: str, default: bool) -> bool:
    val = os.environ.get(key)
    if val is None:
        return default
    return val.lower() in ("true", "1", "yes")


class MullvadRotator:
    """Manages Mullvad VPN connection and IP rotation via city cycling."""

    def __init__(
        self,
        cities: list[str] | None = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
        reconnect_wait: int = DEFAULT_RECONNECT_WAIT,
    ) -> None:
        env_cities = _get_env_str("MULLVAD_CITIES", "")
        if env_cities:
            self.cities = [c.strip() for c in env_cities.split(",") if c.strip()]
        else:
            self.cities = cities or list(US_CITIES)

        self.batch_size = _get_env_int("MULLVAD_BATCH_SIZE", batch_size)
        self.reconnect_wait = _get_env_int("MULLVAD_RECONNECT_WAIT", reconnect_wait)
        self._city_idx = random.randint(0, len(self.cities) - 1)
        self._requests_since_rotation = 0
        self.stats = RotationStats()

    def connect(self, city: str | None = None) -> bool:
        target = city or self.cities[self._city_idx]
        _log("connecting", city=target)

        result = _run_mullvad("relay", "set", "location", "us", target)
        if result.returncode != 0:
            _log("relay_set_failed", level="error", city=target, stderr=result.stderr.strip())
            return False

        result = _run_mullvad("connect")
        if result.returncode != 0:
            _log("connect_failed", level="error", stderr=result.stderr.strip())
            return False

        time.sleep(self.reconnect_wait)

        if not self.is_connected():
            _log("connect_verify_failed", level="error")
            return False

        ip = self.get_ip()
        if ip:
            self.stats.ips_seen.append(ip)
        if target not in self.stats.cities_used:
            self.stats.cities_used.append(target)

        _log("connected", city=target, ip=ip)
        self._requests_since_rotation = 0
        return True

    def disconnect(self) -> None:
        _run_mullvad("disconnect")
        _log("disconnected")

    def reconnect(self) -> bool:
        _log("reconnecting")
        result = _run_mullvad("reconnect")
        if result.returncode != 0:
            _log("reconnect_failed", level="error", stderr=result.stderr.strip())
            return False

        time.sleep(self.reconnect_wait)

        if not self.is_connected():
            _log("reconnect_verify_failed", level="error")
            return False

        ip = self.get_ip()
        if ip:
            self.stats.ips_seen.append(ip)
        self.stats.rotations += 1
        self._requests_since_rotation = 0

        _log("reconnected", ip=ip, rotation=self.stats.rotations)
        return True

    def rotate(self) -> bool:
        self._city_idx = (self._city_idx + 1) % len(self.cities)
        return self.connect(self.cities[self._city_idx])

    def should_rotate(self) -> bool:
        return self._requests_since_rotation >= self.batch_size

    def record_request(self) -> None:
        self._requests_since_rotation += 1
        self.stats.total_requests += 1

    def record_success(self) -> None:
        self.stats.successful_requests += 1

    def record_failure(self) -> None:
        self.stats.failed_requests += 1

    def record_rate_limit(self) -> None:
        self.stats.rate_limits_hit += 1

    def record_timeout(self) -> None:
        self.stats.timeouts += 1

    def is_connected(self) -> bool:
        result = _run_mullvad("status")
        return "Connected" in result.stdout

    def get_ip(self) -> str | None:
        result = _run_mullvad("status")
        for line in result.stdout.splitlines():
            if "IPv4:" in line:
                return line.split("IPv4:")[-1].strip().rstrip(".")
        return None

    def get_status(self) -> str:
        result = _run_mullvad("status")
        return result.stdout.strip()

    def enable_lockdown(self) -> None:
        _run_mullvad("lockdown-mode", "set", "on")
        _log("lockdown_enabled")

    def disable_lockdown(self) -> None:
        _run_mullvad("lockdown-mode", "set", "off")
        _log("lockdown_disabled")


class Socks5Rotator:
    """Rotates through Mullvad SOCKS5 proxies for instant IP switching without reconnect."""

    LOCAL_PROXY = "socks5h://10.64.0.1:1080"

    def __init__(self, proxies: list[str] | None = None) -> None:
        env_proxies = _get_env_str("MULLVAD_SOCKS5_PROXIES", "")
        if env_proxies:
            self.proxies = [p.strip() for p in env_proxies.split(",") if p.strip()]
        elif proxies:
            self.proxies = list(proxies)
        else:
            self.proxies = [self.LOCAL_PROXY]

        self._idx = 0

    def next_proxy(self) -> dict[str, str]:
        proxy = self.proxies[self._idx % len(self.proxies)]
        self._idx += 1
        return {"http": proxy, "https": proxy}

    @property
    def proxy_count(self) -> int:
        return len(self.proxies)


class NbaApiSession(requests.Session):
    """HTTP session with rate limiting, retry, IP rotation, and UA rotation."""

    def __init__(
        self,
        mullvad: MullvadRotator | None = None,
        socks5: Socks5Rotator | None = None,
        request_delay: float = DEFAULT_REQUEST_DELAY,
        max_retries: int = DEFAULT_MAX_RETRIES,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> None:
        super().__init__()
        self.headers.update(NBA_HEADERS)

        self.mullvad = mullvad
        self.socks5 = socks5
        self.request_delay = float(_get_env_str("MULLVAD_REQUEST_DELAY", str(request_delay)))
        self.max_retries = _get_env_int("MULLVAD_MAX_RETRIES", max_retries)
        self.timeout = timeout
        self._rotation_mode = _get_env_str("MULLVAD_ROTATION_MODE", "hybrid")
        self._last_request_time = 0.0

        try:
            from fake_useragent import UserAgent
            self._ua = UserAgent(browsers=["chrome", "edge"])
        except ImportError:
            self._ua = None

    def _rotate_ua(self) -> None:
        if self._ua:
            self.headers["User-Agent"] = self._ua.random

    def _throttle(self) -> None:
        elapsed = time.time() - self._last_request_time
        if elapsed < self.request_delay:
            time.sleep(self.request_delay - elapsed)

    def _maybe_proactive_rotate(self) -> None:
        if not self.mullvad:
            return
        if self._rotation_mode in ("vpn", "hybrid") and self.mullvad.should_rotate():
            _log("proactive_rotation", requests_since=self.mullvad._requests_since_rotation)
            self.mullvad.rotate()

    def _reactive_rotate(self) -> None:
        if not self.mullvad:
            return
        if self._rotation_mode in ("vpn", "hybrid"):
            _log("reactive_rotation", level="warn")
            self.mullvad.rotate()

    def _get_socks5_proxy(self) -> dict[str, str] | None:
        if not self.socks5:
            return None
        if self._rotation_mode in ("socks5", "hybrid"):
            return self.socks5.next_proxy()
        return None

    def request(  # type: ignore[override]
        self,
        method: str | bytes,
        url: str | bytes,
        **kwargs: Any,
    ) -> requests.Response:
        kwargs.setdefault("timeout", self.timeout)

        self._throttle()
        self._maybe_proactive_rotate()
        self._rotate_ua()

        proxy = self._get_socks5_proxy()
        if proxy:
            kwargs["proxies"] = proxy

        if self.mullvad:
            self.mullvad.record_request()

        last_exc: Exception | None = None

        for attempt in range(self.max_retries):
            try:
                resp = super().request(method, url, **kwargs)

                if resp.status_code == 200:
                    self._last_request_time = time.time()
                    if self.mullvad:
                        self.mullvad.record_success()
                    return resp

                if resp.status_code == 429:
                    if self.mullvad:
                        self.mullvad.record_rate_limit()
                    _log(
                        "rate_limited",
                        level="warn",
                        url=url,
                        attempt=attempt + 1,
                        retry_after=resp.headers.get("Retry-After"),
                    )
                    self._reactive_rotate()
                    wait = min(2 ** (attempt + 2), 60)
                    time.sleep(wait)
                    continue

                if resp.status_code == 403:
                    _log("forbidden", level="error", url=url, attempt=attempt + 1)
                    self._reactive_rotate()
                    wait = min(2 ** (attempt + 3), 120)
                    time.sleep(wait)
                    continue

                _log(
                    "unexpected_status",
                    level="warn",
                    status=resp.status_code,
                    url=url,
                    attempt=attempt + 1,
                )
                if resp.status_code >= 500:
                    time.sleep(2 ** attempt)
                    continue
                return resp

            except requests.exceptions.Timeout:
                if self.mullvad:
                    self.mullvad.record_timeout()
                _log("timeout", level="warn", url=url, attempt=attempt + 1)
                self._reactive_rotate()
                time.sleep(min(2 ** (attempt + 1), 30))
                last_exc = requests.exceptions.Timeout(f"Timed out after {self.timeout}s")

            except requests.exceptions.ConnectionError as e:
                _log("connection_error", level="warn", url=url, attempt=attempt + 1, error=str(e)[:200])
                if self.mullvad and not self.mullvad.is_connected():
                    _log("vpn_disconnected", level="warn")
                    self.mullvad.reconnect()
                time.sleep(min(2 ** attempt, 15))
                last_exc = e

        if self.mullvad:
            self.mullvad.record_failure()

        _log("all_retries_exhausted", level="error", url=url, max_retries=self.max_retries)
        raise last_exc or requests.exceptions.RequestException(f"All {self.max_retries} retries exhausted for {url}")


def create_session(
    mullvad: MullvadRotator | None = None,
    socks5: Socks5Rotator | None = None,
    **kwargs: Any,
) -> NbaApiSession:
    return NbaApiSession(mullvad=mullvad, socks5=socks5, **kwargs)


def patch_nba_api_headers() -> None:
    try:
        from nba_api.stats.library import http as stats_http
        from nba_api.library import http as base_http

        stats_http.STATS_HEADERS = dict(NBA_HEADERS)
        stats_http.NBAStatsHTTP.headers = dict(NBA_HEADERS)
        stats_http.NBAStatsHTTP._session = None
        base_http.NBAHTTP._session = None

        _log("nba_api_headers_patched")
    except ImportError:
        _log("nba_api_not_installed", level="warn")


def check_ip() -> str | None:
    try:
        resp = requests.get("https://am.i.mullvad.net/json", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            ip = data.get("ip")
            city = data.get("city")
            country = data.get("country")
            is_mullvad = data.get("mullvad_exit_ip", False)
            _log("ip_check", ip=ip, city=city, country=country, is_mullvad=is_mullvad)
            return ip
    except Exception as e:
        _log("ip_check_failed", level="warn", error=str(e)[:200])
    return None


def health_check(mullvad: MullvadRotator | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "mullvad_cli": False,
        "vpn_connected": False,
        "exit_ip": None,
        "is_mullvad_exit": False,
        "lockdown_mode": False,
    }

    try:
        r = _run_mullvad("--version")
        result["mullvad_cli"] = r.returncode == 0
        result["mullvad_version"] = r.stdout.strip() if r.returncode == 0 else None
    except FileNotFoundError:
        _log("mullvad_cli_not_found", level="error")
        return result

    if mullvad:
        result["vpn_connected"] = mullvad.is_connected()
        result["exit_ip"] = mullvad.get_ip()

    try:
        resp = requests.get("https://am.i.mullvad.net/json", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            result["exit_ip"] = data.get("ip")
            result["is_mullvad_exit"] = data.get("mullvad_exit_ip", False)
    except Exception:
        pass

    r = _run_mullvad("lockdown-mode", "get")
    result["lockdown_mode"] = "on" in r.stdout.lower()

    _log("health_check", **result)
    return result


def setup(
    enable_lockdown: bool = True,
    connect: bool = True,
    city: str | None = None,
) -> tuple[MullvadRotator, NbaApiSession]:
    """One-call setup: create rotator, connect, enable lockdown, return session."""
    lockdown = _get_env_bool("MULLVAD_LOCKDOWN", enable_lockdown)

    rotator = MullvadRotator()

    if lockdown:
        rotator.enable_lockdown()

    if connect:
        if not rotator.connect(city):
            _log("setup_connect_failed", level="error")
            raise RuntimeError("Failed to connect to Mullvad VPN")

    socks5 = Socks5Rotator()
    session = create_session(mullvad=rotator, socks5=socks5)

    patch_nba_api_headers()

    _log("setup_complete", mode=_get_env_str("MULLVAD_ROTATION_MODE", "hybrid"))
    return rotator, session


def teardown(rotator: MullvadRotator, disconnect: bool = False) -> None:
    """Log final stats and optionally disconnect."""
    _log("teardown", stats=rotator.stats.to_dict())
    if disconnect:
        rotator.disconnect()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Mullvad VPN proxy rotation for nba_api")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("status", help="Show Mullvad status")
    sub.add_parser("ip", help="Show current exit IP")
    sub.add_parser("health", help="Run health check")
    sub.add_parser("cities", help="List available US cities")

    connect_p = sub.add_parser("connect", help="Connect to Mullvad")
    connect_p.add_argument("--city", help="City code (e.g., nyc, lax)")

    sub.add_parser("disconnect", help="Disconnect from Mullvad")
    sub.add_parser("reconnect", help="Reconnect (new IP)")
    sub.add_parser("rotate", help="Rotate to next city")

    test_p = sub.add_parser("test", help="Test with a sample nba_api call")
    test_p.add_argument("--count", type=int, default=5, help="Number of test requests")

    args = parser.parse_args()

    if args.command == "status":
        rotator = MullvadRotator()
        print(rotator.get_status())

    elif args.command == "ip":
        ip = check_ip()
        print(f"Exit IP: {ip}")

    elif args.command == "health":
        rotator = MullvadRotator()
        result = health_check(rotator)
        print(json.dumps(result, indent=2))

    elif args.command == "cities":
        for city in US_CITIES:
            print(city)

    elif args.command == "connect":
        rotator = MullvadRotator()
        ok = rotator.connect(args.city)
        print(f"Connected: {ok}")
        if ok:
            print(rotator.get_status())

    elif args.command == "disconnect":
        rotator = MullvadRotator()
        rotator.disconnect()
        print("Disconnected")

    elif args.command == "reconnect":
        rotator = MullvadRotator()
        ok = rotator.reconnect()
        print(f"Reconnected: {ok}")
        if ok:
            print(rotator.get_status())

    elif args.command == "rotate":
        rotator = MullvadRotator()
        if not rotator.is_connected():
            print("Not connected. Connecting first...")
            rotator.connect()
        ok = rotator.rotate()
        print(f"Rotated: {ok}")
        if ok:
            print(rotator.get_status())

    elif args.command == "test":
        rotator, session = setup()
        try:
            from nba_api.stats.endpoints import commonallplayers
            print(f"Running {args.count} test requests...")
            for i in range(args.count):
                try:
                    result = commonallplayers.CommonAllPlayers(
                        is_only_current_season=1,
                        league_id="00",
                        season="2025-26",
                    )
                    players = result.get_normalized_dict().get("CommonAllPlayers", [])
                    print(f"  [{i+1}/{args.count}] OK - {len(players)} players returned")
                except Exception as e:
                    print(f"  [{i+1}/{args.count}] FAIL - {e}")
                time.sleep(1)
        finally:
            teardown(rotator)
            print(json.dumps(rotator.stats.to_dict(), indent=2))

    else:
        parser.print_help()
