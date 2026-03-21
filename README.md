# SD Smart Park

An AI-powered parking recommendation tool for San Diego. Describe where you're going in plain English and get real, data-backed guidance on where to park — including citation risk.

---

## What It Does

SD Smart Park lets you describe your destination — *"Padres game tonight"* or *"dinner in Little Italy"* — and instantly shows which nearby parking meters are historically most available at that time, which zones carry high citation risk, and a Claude-powered recommendation with specific reasoning.

Built on City of San Diego meter transaction data (2020–2026) and citation records (2012–2025), the app models per-meter availability by day-of-week and hour across ~3,800 active meters, overlaid on an interactive map with color-coded indicators.

---

## Features

- **Natural Language Search** — type a destination or event and get AI-powered parking recommendations with walking distance, cost, and enforcement risk reasoning
- **Agentic Chat** — multi-turn conversation with Claude using 5 tool-use functions (find nearby meters, city overview, top citation zones, area details, best parking citywide)
- **Interactive Map** — CartoDB Dark Matter tiles with color-coded meter markers (green/yellow/red availability) and citation hotspot overlays
- **Availability Curves** — per-meter sparkline charts and full 7-day × 24-hour availability detail views
- **Time Travel** — select any day-of-week and hour to see predicted availability and citation risk
- **Area Browser** — browse ~20 San Diego neighborhoods (Gaslamp, Little Italy, Balboa Park, etc.) with aggregate stats
- **Resizable Layout** — drag-handle panels for meter list, map, and chat

---

## Architecture

```
Frontend (React + Vite)  →  FastAPI Backend  →  Claude API (claude-sonnet-4-6)
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

## Tech Stack

| Layer | Tool |
|---|---|
| Backend | FastAPI, Python 3.11+, Anthropic SDK |
| Frontend | React 18, Vite, react-leaflet |
| AI | Claude Sonnet (tool use / agentic chat) |
| Data Processing | pandas, NumPy |
| Maps | Leaflet, CartoDB tiles, Nominatim geocoding |
| Deployment | Docker (multi-stage), Fly.io, GitHub Actions CI/CD |
| Data | City of San Diego SODA API (public domain) |

---

## Quick Start

### Prerequisites

- Python 3.11+
- [Poetry](https://python-poetry.org/docs/#installation)
- Node.js 18+

### 1. Data Preprocessing

```bash
poetry install

# Preprocess data (run once — detects local CSV in data/ automatically)
poetry run python scripts/preprocess.py
```

### 2. Backend

```bash
cp .env.example .env  # then fill in your Anthropic API key
poetry run uvicorn backend.main:app --reload --port 8000
```

### 3. Frontend (separate terminal)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/find-parking` | AI recommendation + nearby meters |
| POST | `/chat` | Agentic chat with Claude tool use |
| POST | `/resolve-location` | Parse natural language → lat/lon + time |
| GET | `/areas` | List all neighborhoods with centroids |
| GET | `/meters/area` | Meters within a radius |
| GET | `/meter/{id}/curve` | Full 7-day availability curve |
| GET | `/citation-hotspots` | Citation risk grid cells |
| POST | `/refresh` | Manual data refresh from SODA |
| GET | `/health` | Health check with meters loaded count |

---

## Data Sources

| Dataset | Source | Used For |
|---|---|---|
| Parking Meter Locations | data.sandiego.gov | Map markers, zone/rate info |
| Parking Meter Transactions (2020–2026) | data.sandiego.gov | Historical availability model |
| Parking Citations (2012–2025) | data.sandiego.gov | Citation risk scoring |

All data is public domain (PDDL license) via City of San Diego Open Data Portal.

---

## How Availability Is Computed

For each meter, average transaction volume is computed by **(day_of_week × hour)**. High transaction volume = high occupancy = low availability. Scores are normalized within each time bucket relative to the busiest meters in that slot.

This is **predictive**, not live — framed honestly as "historically X% likely available."

---

## Deployment

The app is deployed on [Fly.io](https://fly.io) (LAX region) using a multi-stage Docker build:

1. **Stage 1** — Node 20 builds the React frontend
2. **Stage 2** — Python 3.11 serves the FastAPI backend + static frontend assets

CI/CD is handled via GitHub Actions — every push to `main` triggers `flyctl deploy`.

---

## Live App

[sd-smart-park.fly.dev](https://sd-smart-park.fly.dev)

## Demo Video

[Watch the demo](https://drive.google.com/file/d/1jo6rmbSH8s07UN9ipMbCiZjoD2sM5bQW/view?usp=sharing)

---

## Team

- **Rami Ariss** — Project Lead
- **Kevin Kakkary** — Senior Vibe Coder
- **Christian Miramontes** — Junior Vibe Analyst

---

Built by [Kevin Kakkary](https://github.com/kkakkary)
