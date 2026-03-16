#!/usr/bin/env python3
"""
SD Smart Parking - Data Preprocessing Script
Downloads and processes San Diego parking meter data into a fast lookup table.

Checks for a pre-built local CSV first (data/meter_temporal_occupancy.csv).
If found and valid, derives meter_locations.json and availability_scores.json
from it directly — no network needed.

Usage:
    poetry run python scripts/preprocess.py

Output:
    ../data/meter_locations.json     - Active meter locations with zone/rate info
    ../data/availability_scores.json - Per-meter availability by day/hour, plus
                                       citation_prob and avg_fine if present in CSV
"""

import pandas as pd
import requests
import json
import os
from io import StringIO
from collections import defaultdict

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
os.makedirs(DATA_DIR, exist_ok=True)

# Local pre-built CSV (output of occupancy_analysis.py)
LOCAL_CSV = os.path.join(DATA_DIR, "meter_temporal_occupancy.csv")

# Required columns and their expected dtypes for validation
REQUIRED_COLUMNS = {
    "pole_id": object,
    "day_of_week": object,
    "hour": "int64",
    "occupancy_prob": "float64",
    "latitude": "float64",
    "longitude": "float64",
}

VALID_DAYS = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"}
DOW_MAP = {"Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3,
           "Friday": 4, "Saturday": 5, "Sunday": 6}

# SD bounding box (tighter than the raw data to exclude bad coords like 32.0)
SD_LAT = (32.53, 33.2)
SD_LON = (-117.4, -116.9)

# --- Data Sources (Socrata SODA API) ---
METER_LOCATIONS_URL = "https://seshat.datasd.org/parking_meters/parking_meter_locations_datasd_v1.csv"
TRANSACTIONS_2024_DAY_URL = "https://seshat.datasd.org/parking_meters/treas_parking_payments_2024_datasd.csv"
TRANSACTIONS_2025_DAY_URL = "https://seshat.datasd.org/parking_meters/treas_parking_payments_2025_datasd.csv"


# ── Local CSV path ─────────────────────────────────────────────────────────────

def validate_local_csv(df):
    """
    Validate that the local CSV has the expected schema and sensible values.
    Returns (ok: bool, reason: str).
    """
    # 1. Required columns present
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        return False, f"Missing columns: {missing}"

    # 2. Dtypes roughly match (int64 and float64 can be checked as numeric)
    if not pd.api.types.is_integer_dtype(df["hour"]):
        return False, f"'hour' column expected integer, got {df['hour'].dtype}"
    if not pd.api.types.is_float_dtype(df["occupancy_prob"]):
        return False, f"'occupancy_prob' expected float, got {df['occupancy_prob'].dtype}"
    if not pd.api.types.is_float_dtype(df["latitude"]):
        return False, f"'latitude' expected float, got {df['latitude'].dtype}"

    # 3. hour in [0, 23]
    bad_hours = df["hour"].dropna()
    if bad_hours.min() < 0 or bad_hours.max() > 23:
        return False, f"'hour' out of range [0,23]: min={bad_hours.min()}, max={bad_hours.max()}"

    # 4. occupancy_prob in [0, 1]
    occ = df["occupancy_prob"].dropna()
    if occ.min() < 0 or occ.max() > 1:
        return False, f"'occupancy_prob' out of range [0,1]: min={occ.min():.3f}, max={occ.max():.3f}"

    # 5. day_of_week contains only valid day names
    invalid_days = set(df["day_of_week"].dropna().unique()) - VALID_DAYS
    if invalid_days:
        return False, f"Unexpected day_of_week values: {invalid_days}"

    # 6. Sanity check: at least 1000 rows (real dataset has 300k+)
    if len(df) < 1000:
        return False, f"Suspiciously few rows: {len(df)}"

    return True, "ok"


def filter_active_meters(df):
    """
    Filter to currently active, locatable meters:
      - Has valid lat/lon within San Diego bounds
      - Not a test zone or null zone
    """
    before = len(df)

    # Drop null lat/lon
    df = df.dropna(subset=["latitude", "longitude"])

    # Filter to SD bounding box (removes bad coords like exactly 32.0)
    df = df[
        df["latitude"].between(*SD_LAT) &
        df["longitude"].between(*SD_LON)
    ]

    # Drop test zones and rows with no zone
    df = df[df["zone"].notna()]
    df = df[df["zone"].str.strip().str.lower() != "test zone"]

    after_meters = df["pole_id"].nunique()
    print(f"  Filtered {before:,} → {len(df):,} rows | {after_meters:,} active meters")
    return df


# ── Derive JSONs from local CSV ────────────────────────────────────────────────

def process_from_local_csv(df):
    """Derive meter_locations.json and availability_scores.json from local CSV."""

    # ── [1/2] Meter locations ──────────────────────────────────────────────────
    print("\n[1/2] Building meter locations from local CSV...")

    loc_cols = ["pole_id", "latitude", "longitude", "zone", "area"]
    optional = ["sub-area", "price", "time_limit", "days_in_operation", "time_start", "time_end"]
    for col in optional:
        if col in df.columns:
            loc_cols.append(col)

    locations = (
        df[loc_cols]
        .drop_duplicates(subset=["pole_id"])
        .rename(columns={
            "pole_id": "meter_id",
            "latitude": "lat",
            "longitude": "lon",
            "sub-area": "street_address",
            "price": "rate_range",
        })
    )

    out_locations = locations.to_dict(orient="records")
    with open(os.path.join(DATA_DIR, "meter_locations.json"), "w") as f:
        json.dump(out_locations, f)
    print(f"  ✓ Saved {len(out_locations):,} meter locations")

    # ── [2/2] Availability scores ──────────────────────────────────────────────
    print("\n[2/2] Building availability scores from local CSV...")

    has_citation_prob = "citation_prob" in df.columns
    has_avg_fine = "avg_fine" in df.columns
    if has_citation_prob or has_avg_fine:
        print(f"  Found citation columns: citation_prob={has_citation_prob}, avg_fine={has_avg_fine}")

    avail_df = df[["pole_id", "day_of_week", "hour", "occupancy_prob"]].copy()
    avail_df["dow"] = avail_df["day_of_week"].map(DOW_MAP)
    avail_df["avail"] = (1 - avail_df["occupancy_prob"]).round(2).clip(0, 1)
    if has_citation_prob:
        avail_df["citation_prob"] = df["citation_prob"]
    if has_avg_fine:
        avail_df["avg_fine"] = df["avg_fine"]

    # Build per-meter dict: { meter_id: { scores: [...], citation_prob, avg_fine } }
    scores = {}
    for _, row in avail_df.iterrows():
        mid = str(row["pole_id"])
        if mid not in scores:
            scores[mid] = {
                "scores": [],
                "citation_prob": float(row["citation_prob"]) if has_citation_prob and pd.notna(row.get("citation_prob")) else 0.0,
                "avg_fine": float(row["avg_fine"]) if has_avg_fine and pd.notna(row.get("avg_fine")) else 0.0,
            }
        scores[mid]["scores"].append({
            "dow": int(row["dow"]),
            "hour": int(row["hour"]),
            "avail": float(row["avail"]),
        })

    with open(os.path.join(DATA_DIR, "availability_scores.json"), "w") as f:
        json.dump(scores, f)
    print(f"  ✓ Scored {len(scores):,} meters across day/hour buckets")


def download_csv(url, label):
    print(f"  Downloading {label}...")
    try:
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        df = pd.read_csv(StringIO(r.text))
        print(f"  ✓ {label}: {len(df):,} rows")
        return df
    except Exception as e:
        print(f"  ✗ Failed to download {label}: {e}")
        return None


def process_meter_locations(df):
    """Clean and export meter location data."""
    print("\n[1/3] Processing meter locations...")

    # Normalize column names (vary slightly across years)
    df.columns = [c.lower().strip() for c in df.columns]

    # Find lat/lon columns
    lat_col = next((c for c in df.columns if "lat" in c), None)
    lon_col = next((c for c in df.columns if "lon" in c or "lng" in c), None)
    id_col = next((c for c in df.columns if "meter" in c and "id" in c), "meter_id")

    if not lat_col or not lon_col:
        print(f"  Columns available: {list(df.columns)}")
        raise ValueError("Could not find lat/lon columns")

    df = df.rename(columns={lat_col: "lat", lon_col: "lon", id_col: "meter_id"})

    # Drop rows without geo
    df = df.dropna(subset=["lat", "lon"])
    df = df[df["lat"].between(32.5, 33.2) & df["lon"].between(-117.4, -116.9)]

    # Keep useful columns
    keep = ["meter_id", "lat", "lon"]
    for col in ["zone", "area", "sub_area", "rate_type", "rate_range", "street_address", "on_off_street"]:
        if col in df.columns:
            keep.append(col)

    meters = df[keep].drop_duplicates(subset=["meter_id"])

    out = meters.to_dict(orient="records")
    with open(os.path.join(DATA_DIR, "meter_locations.json"), "w") as f:
        json.dump(out, f)

    print(f"  ✓ Saved {len(out):,} meters")
    return meters


def process_transactions(dfs):
    """Compute availability scores per meter by day-of-week and hour."""
    print("\n[2/3] Processing transaction history...")

    all_rows = []
    for df in dfs:
        if df is None:
            continue
        df.columns = [c.lower().strip() for c in df.columns]

        # Find date/time column
        date_col = next((c for c in df.columns if "date" in c or "time" in c), None)
        meter_col = next((c for c in df.columns if "meter" in c and "id" in c), None)

        if not date_col or not meter_col:
            print(f"  Skipping df - columns: {list(df.columns)}")
            continue

        df = df.rename(columns={date_col: "trans_date", meter_col: "meter_id"})
        df["trans_date"] = pd.to_datetime(df["trans_date"], errors="coerce")
        df = df.dropna(subset=["trans_date", "meter_id"])
        df["dow"] = df["trans_date"].dt.dayofweek   # 0=Mon, 6=Sun
        df["hour"] = df["trans_date"].dt.hour
        all_rows.append(df[["meter_id", "dow", "hour"]])

    if not all_rows:
        print("  No transaction data available - generating sample data")
        return generate_sample_scores()

    combined = pd.concat(all_rows, ignore_index=True)

    # Count transactions per (meter, dow, hour)
    counts = combined.groupby(["meter_id", "dow", "hour"]).size().reset_index(name="tx_count")

    # Normalize to 0-1 occupancy score within each (dow, hour) bucket
    # High transaction count = high occupancy = low availability
    bucket_max = counts.groupby(["dow", "hour"])["tx_count"].transform("max")
    counts["occupancy"] = counts["tx_count"] / bucket_max.clip(lower=1)
    counts["availability"] = (1 - counts["occupancy"]).round(2)

    # Build lookup dict: meter_id -> { scores: [{dow, hour, avail}], citation_prob, avg_fine }
    scores = {}
    for _, row in counts.iterrows():
        mid = str(row["meter_id"])
        if mid not in scores:
            scores[mid] = {"scores": [], "citation_prob": 0.0, "avg_fine": 0.0}
        scores[mid]["scores"].append({
            "dow": int(row["dow"]),
            "hour": int(row["hour"]),
            "avail": float(row["availability"])
        })

    with open(os.path.join(DATA_DIR, "availability_scores.json"), "w") as f:
        json.dump(scores, f)

    print(f"  ✓ Scored {len(scores):,} meters across day/hour buckets")
    return scores


def generate_sample_scores():
    """Fallback: generate realistic-looking sample scores for demo."""
    import random
    random.seed(42)

    # Simulate ~2000 meters with realistic patterns
    scores = {}
    for i in range(2000):
        meter_id = f"SAMPLE_{i:04d}"
        entries = []
        for dow in range(7):
            for hour in range(6, 23):
                # Base pattern: busy midday weekdays, busy evenings/weekends
                base = 0.5
                if dow < 5:  # Weekday
                    if 11 <= hour <= 14:
                        base = 0.2  # lunch rush
                    elif 8 <= hour <= 9:
                        base = 0.3  # morning
                else:  # Weekend
                    if 18 <= hour <= 21:
                        base = 0.15  # evening
                    elif 12 <= hour <= 17:
                        base = 0.3

                avail = max(0.05, min(0.95, base + random.gauss(0, 0.15)))
                entries.append({"dow": dow, "hour": hour, "avail": round(avail, 2)})
        scores[meter_id] = {
            "scores": entries,
            "citation_prob": round(random.uniform(0, 0.5), 2),
            "avg_fine": round(random.uniform(30, 100), 2),
        }

    with open(os.path.join(DATA_DIR, "availability_scores.json"), "w") as f:
        json.dump(scores, f)

    print(f"  ✓ Generated sample scores for {len(scores):,} meters")
    return scores



def main():
    print("=" * 50)
    print("SD Smart Parking — Data Preprocessor")
    print("=" * 50)

    # ── Step 1 & 2: Meter locations + availability scores ──────────────────────
    if os.path.exists(LOCAL_CSV):
        print(f"\nFound local CSV: {LOCAL_CSV}")
        print("  Loading...")
        local_df = pd.read_csv(LOCAL_CSV)
        print(f"  {len(local_df):,} rows, {local_df['pole_id'].nunique():,} unique meters")

        ok, reason = validate_local_csv(local_df)
        if not ok:
            print(f"  ✗ Validation failed: {reason}")
            print("  Falling back to SODA API downloads...")
            local_df = None
        else:
            print(f"  ✓ Schema valid")

        if local_df is not None:
            local_df = filter_active_meters(local_df)
            process_from_local_csv(local_df)
    else:
        print(f"\nNo local CSV found at {LOCAL_CSV}")
        print("Downloading meter data from data.sandiego.gov...")
        locations_df = download_csv(METER_LOCATIONS_URL, "Meter Locations")
        tx_2024 = download_csv(TRANSACTIONS_2024_DAY_URL, "Transactions 2024")
        tx_2025 = download_csv(TRANSACTIONS_2025_DAY_URL, "Transactions 2025")

        if locations_df is not None:
            process_meter_locations(locations_df)
        else:
            print("⚠️  No location data — frontend will use sample data")

        process_transactions([tx_2024, tx_2025])

    print("\n✅ All done! Data written to /data/")
    print("   meter_locations.json")
    print("   availability_scores.json  (includes citation_prob + avg_fine per meter)")


if __name__ == "__main__":
    main()