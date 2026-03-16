"""
SD Smart Parking - FastAPI Backend
Claude-powered parking recommendations using historical SD meter data.

Setup:
    pip install fastapi uvicorn anthropic python-dotenv

Run:
    uvicorn main:app --reload --port 8000
"""

import asyncio
import json
import os
import math
import subprocess
import sys
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import anthropic
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

REFRESH_INTERVAL_HOURS = 24
LAST_REFRESHED: Optional[str] = None


def run_preprocess():
    """Re-download from SODA and rebuild JSON data files."""
    script = os.path.join(os.path.dirname(__file__), "..", "scripts", "preprocess.py")
    result = subprocess.run(
        [sys.executable, script, "--force-soda"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    return result.stdout


def reload_data():
    """Hot-reload in-memory data from JSON files after a refresh."""
    global METERS, AVAILABILITY, HOTSPOTS, AREAS, LAST_REFRESHED
    METERS = load_json("meter_locations.json")
    AVAILABILITY = load_json("availability_scores.json")
    HOTSPOTS = load_json("citation_hotspots.json")
    AREAS = _build_areas()
    LAST_REFRESHED = datetime.now().isoformat()
    print(f"Data reloaded: {len(METERS):,} meters, {len(AVAILABILITY):,} availability records, {len(HOTSPOTS):,} hotspot cells")


async def auto_refresh_loop():
    """Background task: refresh data from SODA every REFRESH_INTERVAL_HOURS."""
    while True:
        await asyncio.sleep(REFRESH_INTERVAL_HOURS * 3600)
        print(f"Auto-refresh starting...")
        try:
            output = run_preprocess()
            reload_data()
            print(f"Auto-refresh complete.")
        except Exception as e:
            print(f"Auto-refresh failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(auto_refresh_loop())
    yield
    task.cancel()


app = FastAPI(title="SD Smart Parking API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# ── Load data at startup ───────────────────────────────────────────────────────
def load_json(filename):
    path = os.path.join(DATA_DIR, filename)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}

METERS: list = load_json("meter_locations.json")
AVAILABILITY: dict = load_json("availability_scores.json")
HOTSPOTS: list = load_json("citation_hotspots.json")

print(f"Loaded {len(METERS):,} meters, {len(AVAILABILITY):,} availability records, {len(HOTSPOTS):,} hotspot cells")

# ── Helpers ────────────────────────────────────────────────────────────────────
def haversine(lat1, lon1, lat2, lon2) -> float:
    """Distance in meters between two lat/lon points."""
    R = 6371000
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    Δφ = math.radians(lat2 - lat1)
    Δλ = math.radians(lon2 - lon1)
    a = math.sin(Δφ/2)**2 + math.cos(φ1)*math.cos(φ2)*math.sin(Δλ/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def get_availability(meter_id: str, dow: int, hour: int) -> float:
    """Get historical availability score (0=full, 1=empty) for a meter/time."""
    meter_data = AVAILABILITY.get(str(meter_id), {})
    entries = meter_data.get("scores", []) if isinstance(meter_data, dict) else meter_data
    for entry in entries:
        if entry["dow"] == dow and entry["hour"] == hour:
            return entry["avail"]
    return 0.5  # default: unknown


def get_citation_data(meter_id: str) -> tuple:
    """Return (citation_prob, avg_fine) for a meter from availability_scores."""
    meter_data = AVAILABILITY.get(str(meter_id), {})
    if isinstance(meter_data, dict):
        return meter_data.get("citation_prob", 0.0), meter_data.get("avg_fine", 0.0)
    return 0.0, 0.0


def sanitize(obj):
    """Recursively replace NaN/Inf floats with None so JSON serialization doesn't blow up."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    return obj


def find_nearby_meters(lat: float, lon: float, radius_m: int = 400, limit: int = 20,
                       dow: int = None, hour: int = None) -> list:
    """Find meters within radius, enriched with availability and citation risk."""
    if dow is None or hour is None:
        now = datetime.now()
        if dow is None:
            dow = now.weekday()
        if hour is None:
            hour = now.hour

    results = []
    for meter in METERS:
        dist = haversine(lat, lon, meter["lat"], meter["lon"])
        if dist <= radius_m:
            meter_id = meter["meter_id"]
            avail = get_availability(meter_id, dow, hour)
            citation_prob, avg_fine = get_citation_data(meter_id)
            results.append(sanitize({
                **meter,
                "distance_m": round(dist),
                "availability": avail,
                "citation_prob": citation_prob,
                "avg_fine": avg_fine,
                "dow": dow,
                "hour": hour,
            }))

    results.sort(key=lambda x: -(x["availability"] or 0))
    return results[:limit]


def build_claude_prompt(query: str, meters: list, dow: int, hour: int) -> str:
    DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    day_name = DAY_NAMES[dow]

    meter_summary = []
    for m in meters[:10]:  # send top 10 to Claude
        avail_pct = int(m["availability"] * 100)
        citation_prob = m.get("citation_prob") or 0.0
        avg_fine = m.get("avg_fine") or 0.0
        fine_str = f", avg ${avg_fine:.0f} fine" if avg_fine else ""
        if citation_prob > 0.06:
            citation_str = f"High Ticket Risk ({int(citation_prob * 100)}%{fine_str})"
        elif citation_prob > 0.03:
            citation_str = f"Some Enforcement ({int(citation_prob * 100)}%{fine_str})"
        else:
            citation_str = "Low Risk"
        addr = m.get("street_address", f"lat {m['lat']:.4f}, lon {m['lon']:.4f}")
        rate = m.get("rate_range", "unknown rate")
        zone = m.get("zone", "")
        meter_summary.append(
            f"- Meter {m['meter_id']} at {addr} | Zone: {zone} | Rate: {rate} | "
            f"Distance: {m['distance_m']}m | Availability: {avail_pct}% | {citation_str}"
        )

    meters_text = "\n".join(meter_summary) if meter_summary else "No meter data available nearby."

    return f"""You are SD Smart Parking, an AI assistant helping San Diego residents find the best parking.

The user's request: "{query}"

Current time context: {day_name} at {hour}:00

Nearby parking meters (sorted by availability):
{meters_text}

Based on this data, provide a concise, helpful parking recommendation. Include:
1. Your top 1-2 recommended spots with specific reasoning (availability %, walking distance, cost)
2. Any citation risk warnings for the area
3. One practical tip (e.g., nearby free street parking windows, time limits to watch for)

Keep your response conversational, specific, and under 150 words. Be direct — give the actual recommendation first.
"""


# Pre-compute area centroids at startup
def _build_areas():
    from collections import defaultdict
    buckets = defaultdict(list)
    for m in METERS:
        area = m.get("area")
        if area:
            buckets[area].append(m)
    result = []
    for area, ms in buckets.items():
        lats = [m["lat"] for m in ms if m.get("lat") is not None]
        lons = [m["lon"] for m in ms if m.get("lon") is not None]
        result.append({
            "name": area,
            "count": len(ms),
            "lat": round(sum(lats) / len(lats), 6) if lats else None,
            "lon": round(sum(lons) / len(lons), 6) if lons else None,
        })
    return sorted(result, key=lambda x: -x["count"])

AREAS = _build_areas()
print(f"Built {len(AREAS)} areas")

# ── API Routes ─────────────────────────────────────────────────────────────────
class ParkingQuery(BaseModel):
    query: str
    lat: float
    lon: float
    radius_m: Optional[int] = 400
    dow: Optional[int] = None   # 0=Mon … 6=Sun; None = use server time
    hour: Optional[int] = None  # 0-23; None = use server time
    meters: Optional[list] = None  # pre-fetched meters from frontend (with citation data)


class MeterDetailQuery(BaseModel):
    meter_id: str


class LocationQuery(BaseModel):
    query: str


class ChatQuery(BaseModel):
    message: str
    history: Optional[list] = []  # list of {role, content} for multi-turn


@app.post("/resolve-location")
async def resolve_location(req: LocationQuery):
    """Use Claude to extract destination coordinates and optional day/time, then find nearest area."""
    prompt = f"""The user is looking for parking in San Diego. They said: "{req.query}"

Extract the destination and any mentioned day/time. Respond with ONLY valid JSON, no extra text:
{{
  "location_name": "<place or landmark name>",
  "lat": <latitude>,
  "lon": <longitude>,
  "reasoning": "<one sentence>",
  "dow": <0-6 where 0=Monday, 6=Sunday, or null if not mentioned>,
  "hour": <0-23 in 24h format, or null if not mentioned>
}}

Location examples:
- "Padres game tonight" → Petco Park → lat 32.7073, lon -117.1566
- "Dinner in Little Italy" → Little Italy, SD → lat 32.7249, lon -117.1699
- "Balboa Park museum" → Balboa Park → lat 32.7341, lon -117.1446

Day/time examples:
- "Saturday at 3pm" → dow 5, hour 15
- "Friday night around 8" → dow 4, hour 20
- "tomorrow morning" → null (relative, cannot resolve)
- "tonight" → null (relative, cannot resolve)

If no specific location is mentioned, default to downtown San Diego: lat 32.7157, lon -117.1611.
If no specific day or time is mentioned, use null for dow and hour."""

    message = None
    try:
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=150,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = message.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw.strip())
        target_lat = result.get("lat")
        target_lon = result.get("lon")

        response: dict = {
            "location_name": result.get("location_name", ""),
            "reasoning": result.get("reasoning", ""),
            "dow": result.get("dow"),    # int 0-6 or None
            "hour": result.get("hour"),  # int 0-23 or None
        }

        if target_lat and target_lon:
            nearest = min(
                (a for a in AREAS if a.get("lat") and a.get("lon")),
                key=lambda a: haversine(target_lat, target_lon, a["lat"], a["lon"])
            )
            response["area"] = nearest
            return response
    except Exception as e:
        print(f"resolve-location error: {e} | raw: {message.content[0].text if message else 'no response'}")

    return {"area": AREAS[0], "location_name": "", "reasoning": "Could not parse location, using default area", "dow": None, "hour": None}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "meters_loaded": len(METERS),
        "last_refreshed": LAST_REFRESHED,
        "next_refresh_in_hours": REFRESH_INTERVAL_HOURS,
    }


@app.post("/refresh")
async def manual_refresh():
    """Manually trigger a SODA data refresh."""
    try:
        output = run_preprocess()
        reload_data()
        return {"status": "ok", "last_refreshed": LAST_REFRESHED, "meters_loaded": len(METERS)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/citation-hotspots")
def citation_hotspots():
    """Return citation risk hotspot grid cells for map overlay."""
    return HOTSPOTS


@app.get("/areas")
def list_areas():
    """Return all areas that have meter data, with centroid lat/lon and meter count."""
    return AREAS


@app.post("/find-parking")
async def find_parking(req: ParkingQuery):
    """Main endpoint: find best parking near a location with Claude recommendation."""
    now = datetime.now()
    dow = req.dow if req.dow is not None else now.weekday()
    hour = req.hour if req.hour is not None else now.hour

    # Use pre-fetched meters from frontend if provided (already have citation data);
    # otherwise fall back to a fresh DB lookup.
    if req.meters:
        nearby = sanitize(req.meters)
    else:
        nearby = find_nearby_meters(req.lat, req.lon, req.radius_m, dow=dow, hour=hour)

    if not nearby:
        raise HTTPException(status_code=404, detail="No meters found in that area")

    # Call Claude
    prompt = build_claude_prompt(req.query, nearby, dow, hour)
    try:
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )
        recommendation = message.content[0].text
    except Exception as e:
        recommendation = f"Unable to generate AI recommendation: {str(e)}"

    return {
        "recommendation": recommendation,
        "meters": nearby,
        "query_time": {"dow": dow, "hour": hour},
    }


@app.get("/meter/{meter_id}/curve")
def meter_curve(meter_id: str):
    """Return full availability curve for a meter (for sparkline chart)."""
    meter_data = AVAILABILITY.get(meter_id, {})
    if not meter_data:
        raise HTTPException(status_code=404, detail="No data for this meter")
    scores = meter_data.get("scores", []) if isinstance(meter_data, dict) else meter_data
    return {"meter_id": meter_id, "curve": scores}


@app.get("/meters/area")
def meters_in_area(lat: float, lon: float, radius_m: int = 1000, limit: int = 400,
                   dow: Optional[int] = None, hour: Optional[int] = None):
    """Return all meters in an area (for map rendering without AI)."""
    return find_nearby_meters(lat, lon, radius_m, limit=min(limit, 500), dow=dow, hour=hour)