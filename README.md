# SD Smart Park

An AI-powered parking recommendation tool for San Diego. Describe where you're going in plain English and get real, data-backed guidance on where to park — including citation risk.

---

## What It Does

SD Smart Park lets you describe your destination — *"Padres game tonight"* or *"dinner in Little Italy"* — and instantly shows which nearby parking meters are historically most available at that time, which zones carry high citation risk, and a Claude-powered recommendation with specific reasoning. Built on City of San Diego meter transaction data, the app models per-meter availability by day-of-week and hour, overlaid on an interactive map with color-coded indicators.

---

## Architecture

```
Frontend (React)  →  FastAPI Backend  →  Claude API
                           ↓
                    pre-processed JSON
                    (meter locations +
                     availability scores +
                     citation hotspots)
                           ↑
                    preprocess.py
                           ↑
              data.sandiego.gov SODA API
```

---

## Quick Start

### Prerequisites

- Python 3.11+
- [Poetry](https://python-poetry.org/docs/#installation)
- Node.js 18+

### 1. Data Preprocessing

```bash
# Install deps and create .venv in project root
poetry install

# Preprocess data (run once — detects local CSV in data/ automatically)
poetry run python scripts/preprocess.py
```

### 2. Backend (Python)
```bash
cp .env.example .env  # then fill in your Anthropic API key
poetry run uvicorn backend.main:app --reload --port 8000
```

### 3. Frontend (npm, separate terminal)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

---

### Notes on Preprocessing

`preprocess.py` checks for `data/meter_temporal_occupancy.csv` first. If found and valid, it builds `meter_locations.json` and `availability_scores.json` locally — no downloads needed. Citation hotspots are always fetched from the SODA API.

If the local CSV is not present, all data is downloaded from `data.sandiego.gov`:
- `meter_locations.json` — ~3,800 active meters with lat/lon and zone info
- `availability_scores.json` — per-meter availability by day-of-week + hour
- `citation_hotspots.json` — citation density grid cells

---

## Data Sources

| Dataset | URL | Used For |
|---|---|---|
| Parking Meter Locations | data.sandiego.gov/datasets/parking-meters-locations | Map markers, zone/rate info |
| Parking Meter Transactions (2020–2026) | data.sandiego.gov/datasets/parking-meters-transactions | Historical availability model |
| Parking Citations (2012–2025) | data.sandiego.gov/datasets/parking-citations | Citation risk scoring |

All data is public domain (PDDL license) via City of San Diego Open Data Portal.

---

## How Availability Is Computed

For each meter, average transaction volume is computed by **(day_of_week × hour)**. High transaction volume = high occupancy = **low availability**. Scores are normalized within each time bucket relative to the busiest meters in that slot.

Result: `meter_id → {mon_9am: 0.72, mon_10am: 0.81, ...}`

This is **predictive**, not live — framed honestly as "historically X% likely available."

---

## API Endpoints

```
POST /find-parking
  body: { query, lat, lon, radius_m }
  → { recommendation (Claude text), meters [] }

GET /meters/area?lat=&lon=&radius_m=
  → meters [] with availability scores

GET /meter/{id}/curve
  → full availability curve across the week

GET /health
  → { status, meters_loaded }
```

---

## Demo Video

[Watch the demo](https://drive.google.com/file/d/1jo6rmbSH8s07UN9ipMbCiZjoD2sM5bQW/view?usp=sharing)

---

## Tech Stack

| Layer | Tool |
|---|---|
| Data prep | Python + pandas |
| Backend | FastAPI + Anthropic SDK |
| Frontend | React + Vite |
| Maps | react-leaflet |
| AI | Claude Sonnet |
| Data | City of San Diego SODA API |

---

Built by [Kevin Kakkary](https://github.com/kkakkary)
