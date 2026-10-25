"""Only request the measurements needed by the dashboard, without waking the car."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import logging
import math
import re
import time

import httpx
from pyporscheconnectapi.connection import Connection
from pyporscheconnectapi.exceptions import PorscheCaptchaRequiredError, PorscheWrongCredentialsError, PorscheExceptionError
from pyporscheconnectapi.oauth2 import Captcha

from .trips import TRIP_MEASUREMENTS, normalize_trips

# Upstream debug logs can contain tokens, VINs and login forms.
logging.getLogger("pyporscheconnectapi").setLevel(logging.CRITICAL + 1)
logging.getLogger("pyporscheconnectapi").propagate = False

MEASUREMENTS = ("BATTERY_LEVEL", "E_RANGE", "RANGE", "MILEAGE", "CHARGING_SUMMARY", "GLOBAL_TIMESTAMP")


class BridgeError(Exception):
    def __init__(self, code: str, status: int = 502, image: str | None = None):
        self.code, self.status, self.image = code, status, image
        super().__init__(code)


def number(value, maximum=9_007_199_254_740_991):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) and 0 <= value <= maximum else None


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        return None


def normalize(raw: dict, fetched_at: str):
    """Allowlist output; never forward raw responses, identifiers, or location."""
    if not isinstance(raw, dict) or not isinstance(raw.get("measurements"), list):
        raise BridgeError("INVALID_VEHICLE_DATA")
    data = {}
    for item in raw["measurements"]:
        if not isinstance(item, dict) or item.get("key") not in MEASUREMENTS:
            continue
        status = item.get("status")
        if not isinstance(status, dict) or status.get("isEnabled") is not True:
            continue
        if isinstance(item.get("value"), dict):
            data[item["key"]] = item["value"]
    soc = number(data.get("BATTERY_LEVEL", {}).get("percent"), 100)
    range_km = number(data.get("E_RANGE", {}).get("kilometers"))
    if range_km is None:
        range_km = number(data.get("RANGE", {}).get("kilometers"))
    odometer = number(data.get("MILEAGE", {}).get("kilometers"))
    # Charging mode (DIRECT / PROFILE) is not proof that charging is in progress.
    status = data.get("CHARGING_SUMMARY", {}).get("status")
    charging = {"CHARGING": "充電中", "NOT_PLUGGED": "未接続", "CHARGING_COMPLETED": "充電完了", "NOT_CHARGING": "充電していません", "COMPLETED": "充電完了", "ERROR": "充電エラー", "OFF": "停止中"}.get(status) if isinstance(status, str) else None
    measured_at = timestamp(data.get("GLOBAL_TIMESTAMP", {}).get("timestamp"))
    if all(v is None for v in (soc, range_km, odometer, charging)):
        raise BridgeError("NO_VEHICLE_DATA")
    return {"schemaVersion": 1, "fetchedAt": fetched_at, "vehicleTimestamp": measured_at,
            "snapshot": {"timestamp": measured_at or fetched_at, "soc": soc, "rangeKm": range_km,
                         "odometerKm": odometer, "chargingStatus": charging, "source": "api"}}


class PorscheProvider:
    def __init__(self, email: str, password: str, vin: str = "", connection=None):
        self.email, self.password, self.vin = email, password, vin
        self.connection = connection
        self.lock = asyncio.Lock()
        self.cached = None
        self.cached_until = 0.0
        self.retry_after = 0.0
        self.pending_captcha = None
        self.captcha_until = 0.0

    def _connection(self):
        if self.connection is None:
            client = httpx.AsyncClient(timeout=20, follow_redirects=False)
            self.connection = Connection(self.email, self.password, async_client=client)
        return self.connection

    async def close(self):
        if self.connection is not None:
            await self.connection.close()

    def _captcha_error(self):
        if self.pending_captcha and time.monotonic() < self.captcha_until:
            return BridgeError("CAPTCHA_REQUIRED", 409, self.pending_captcha.captcha)
        self.pending_captcha = None
        return None

    async def snapshot(self, captcha_code=None):
        async with self.lock:
            now = time.monotonic()
            if captcha_code is not None:
                if not self._captcha_error():
                    raise BridgeError("CAPTCHA_EXPIRED", 409)
                pending = self.pending_captcha
                oauth = self._connection().oauth2_client
                oauth.captcha = Captcha(captcha_code, pending.state)
                oauth.code_verifier = pending.code_verifier
                self.pending_captcha = None
                self.retry_after = 0
            elif error := self._captcha_error():
                raise error
            elif now < self.cached_until and self.cached:
                return self.cached
            elif now < self.retry_after:
                raise BridgeError("RETRY_LATER", 429)
            try:
                async with asyncio.timeout(30):
                    result = await self._fetch()
                self.cached = result
                self.cached_until = time.monotonic() + 300
                return result
            except PorscheCaptchaRequiredError as exc:
                image = exc.captcha
                if not isinstance(image, str) or len(image) > 512_000 or not image.startswith(("data:image/png;base64,", "data:image/svg+xml", "data:image/jpeg;base64,")):
                    self.retry_after = time.monotonic() + 60
                    raise BridgeError("AUTH_REQUIRED", 401) from None
                self.pending_captcha = exc
                self.captcha_until = time.monotonic() + 300
                raise BridgeError("CAPTCHA_REQUIRED", 409, image) from None
            except PorscheWrongCredentialsError:
                self.retry_after = time.monotonic() + 300
                raise BridgeError("AUTH_REQUIRED", 401) from None
            except PorscheExceptionError as exc:
                code = getattr(exc, "code", None)
                self.retry_after = time.monotonic() + 300
                if code in (400, 401, 403, 423):
                    raise BridgeError("AUTH_REQUIRED", 401) from None
                if code == 429:
                    raise BridgeError("UPSTREAM_RATE_LIMIT", 429) from None
                raise BridgeError("PORSCHE_UNAVAILABLE") from None
            except (TimeoutError, httpx.TimeoutException):
                self.retry_after = time.monotonic() + 60
                raise BridgeError("PORSCHE_TIMEOUT", 504) from None
            except BridgeError:
                self.retry_after = time.monotonic() + 60
                raise
            except Exception:
                self.retry_after = time.monotonic() + 60
                raise BridgeError("PORSCHE_UNAVAILABLE") from None
            finally:
                if self.connection is not None and not self.pending_captcha:
                    self.connection.oauth2_client.captcha = Captcha(None, None)

    async def _fetch(self):
        conn = self._connection()
        if not self.vin:
            vehicles = await conn.get("/connect/v1/vehicles")
            if not isinstance(vehicles, list) or not vehicles:
                raise BridgeError("NO_VEHICLE", 404)
            if len(vehicles) != 1:
                raise BridgeError("SELECT_VEHICLE", 409)
            self.vin = vehicles[0].get("vin", "")
        if not isinstance(self.vin, str) or not re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", self.vin):
            raise BridgeError("INVALID_VIN", 503)
        # Bypass get_stored_overview(), which swallows upstream exceptions.
        started = time.monotonic()
        raw = await conn.get(f"/connect/v1/vehicles/{self.vin}", params=[("mf", key) for key in MEASUREMENTS])
        fetched_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        result = normalize(raw, fetched_at)
        # Optional statistics must not break an otherwise successful vehicle refresh.
        # Keep headroom inside the existing 30-second overall timeout.
        budget = min(6.0, max(0.0, 25.0 - (time.monotonic() - started)))
        try:
            if budget <= 0:
                raise TimeoutError
            async with asyncio.timeout(budget):
                trip_raw = await conn.get(f"/connect/v1/vehicles/{self.vin}", params=[("mf", key) for key in TRIP_MEASUREMENTS])
            result["tripStatistics"] = normalize_trips(trip_raw, fetched_at)
        except Exception:
            result["tripStatistics"] = {"status": "error", "fetchedAt": fetched_at,
                                        "periods": {key: None for key in TRIP_MEASUREMENTS.values()}}
        return result
