import pandas as pd
import numpy as np

CSV_PATH = "treas_parking_payments_2025_datasd.csv"

# ---------------------------------------------------------------------------
# Load & parse
# ---------------------------------------------------------------------------
df = pd.read_csv(CSV_PATH, parse_dates=["date_trans_start", "date_meter_expire"])
df.columns = df.columns.str.strip('"')

print(f"Rows: {len(df):,}")
print(f"Unique meters: {df['pole_id'].nunique():,}")
print(f"Date range: {df['date_trans_start'].min()} → {df['date_trans_start'].max()}")
print(f"\nSample trans_amt stats:\n{df['trans_amt'].describe()}")
print(f"\nmeter_type counts:\n{df['meter_type'].value_counts()}")
print(f"\npay_method counts:\n{df['pay_method'].value_counts()}")

# ---------------------------------------------------------------------------
# Occupancy windows
# Sessions where expiry > start have a real duration.
# Sessions where expiry == start are "instantaneous" (typically cash, unknown duration).
# ---------------------------------------------------------------------------
df["duration_min"] = (df["date_meter_expire"] - df["date_trans_start"]).dt.total_seconds() / 60
df["has_duration"] = df["duration_min"] > 0

print(f"\nTransactions WITH duration info: {df['has_duration'].sum():,} "
      f"({df['has_duration'].mean():.1%})")
print(f"Transactions WITHOUT duration:   {(~df['has_duration']).sum():,}")

# ---------------------------------------------------------------------------
# APPROACH 1: Simple occupancy score per meter
# = (total paid minutes) / (total span of data in minutes)
# Only uses rows with real duration.
# ---------------------------------------------------------------------------
with_dur = df[df["has_duration"]].copy()

meter_stats = with_dur.groupby("pole_id").agg(
    total_paid_min=("duration_min", "sum"),
    num_sessions=("duration_min", "count"),
    avg_session_min=("duration_min", "mean"),
    first_seen=("date_trans_start", "min"),
    last_seen=("date_trans_start", "max"),
).reset_index()

# Span in minutes for each meter (from first to last transaction)
meter_stats["span_min"] = (
    meter_stats["last_seen"] - meter_stats["first_seen"]
).dt.total_seconds() / 60

# Occupancy rate: fraction of time span covered by paid sessions
# Cap at 1.0 since sessions can overlap
meter_stats["occupancy_rate"] = (
    meter_stats["total_paid_min"] / meter_stats["span_min"]
).clip(upper=1.0)

meter_stats = meter_stats.sort_values("occupancy_rate", ascending=False)
print("\n--- Top 10 meters by occupancy rate (sessions with duration only) ---")
print(meter_stats.head(10).to_string(index=False))

# ---------------------------------------------------------------------------
# APPROACH 2: Temporal occupancy heatmap per meter
# (pole_id, day_of_week, hour) → fraction of weeks with activity
# Uses ALL transactions (even instantaneous ones count as "someone was there").
# ---------------------------------------------------------------------------
df["hour"] = df["date_trans_start"].dt.hour
df["day_of_week"] = df["date_trans_start"].dt.day_name()
df["week"] = df["date_trans_start"].dt.isocalendar().week

# For each (pole_id, day_of_week, hour), count distinct weeks with ≥1 transaction
temporal = (
    df.groupby(["pole_id", "day_of_week", "hour"])["week"]
    .nunique()
    .reset_index()
    .rename(columns={"week": "active_weeks"})
)

total_weeks = df["week"].nunique()
temporal["occupancy_prob"] = temporal["active_weeks"] / total_weeks

print(f"\n--- Temporal model built ({total_weeks} weeks of data) ---")
print(temporal.head(10).to_string(index=False))

# ---------------------------------------------------------------------------
# APPROACH 3: Current occupancy check
# Given a pole_id and timestamp, is the meter currently occupied?
# (Only works for sessions with duration info.)
# ---------------------------------------------------------------------------
def is_occupied(pole_id: str, query_time: pd.Timestamp, data: pd.DataFrame) -> dict:
    """Check if a meter has an active paid session at query_time."""
    sessions = data[
        (data["pole_id"] == pole_id)
        & (data["has_duration"])
        & (data["date_trans_start"] <= query_time)
        & (data["date_meter_expire"] >= query_time)
    ]
    return {
        "pole_id": pole_id,
        "query_time": query_time,
        "occupied": len(sessions) > 0,
        "active_sessions": len(sessions),
    }

# Example usage
example_meter = df["pole_id"].value_counts().index[0]
example_time = df["date_trans_start"].median()
result = is_occupied(example_meter, example_time, df)
print(f"\n--- Example occupancy check ---")
print(result)

# ---------------------------------------------------------------------------
# Save outputs
# ---------------------------------------------------------------------------
meter_stats.to_csv("meter_occupancy_scores.csv", index=False)
temporal.to_csv("meter_temporal_occupancy.csv", index=False)
print("\nSaved: meter_occupancy_scores.csv, meter_temporal_occupancy.csv")
