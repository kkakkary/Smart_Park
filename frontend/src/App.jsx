import { useState, useEffect, useCallback, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";

// ── Constants ──────────────────────────────────────────────────────────────────
const API_BASE = "";

const DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];


function availColor(score) {
  if (score >= 0.65) return "#22c55e";
  if (score >= 0.35) return "#f59e0b";
  return "#ef4444";
}

function availLabel(score) {
  if (score >= 0.65) return "Likely Available";
  if (score >= 0.35) return "Moderate";
  return "Usually Full";
}

function riskLabel(citation_prob, avg_fine) {
  const fine = avg_fine ? ` · avg $${Math.round(avg_fine)}` : "";
  if (citation_prob > 0.06) return { text: `High Ticket Risk${fine}`, color: "#ef4444" };
  if (citation_prob > 0.03) return { text: `Some Enforcement${fine}`, color: "#f59e0b" };
  return { text: "Low Risk", color: "#22c55e" };
}

// ── Sample data generator (for demo without backend) ───────────────────────────
function generateSampleMeters(centerLat, centerLon) {
  const meters = [];
  const streets = ["Broadway", "5th Ave", "6th Ave", "Market St", "G St", "F St", "Island Ave"];
  for (let i = 0; i < 30; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const dist = Math.random() * 0.004;
    const avail = Math.random();
    meters.push({
      meter_id: `METER_${i}`,
      lat: centerLat + Math.cos(angle) * dist,
      lon: centerLon + Math.sin(angle) * dist,
      distance_m: Math.round(50 + Math.random() * 350),
      availability: parseFloat(avail.toFixed(2)),
      citation_prob: parseFloat((Math.random() * 0.8).toFixed(2)),
      avg_fine: parseFloat((30 + Math.random() * 70).toFixed(0)),
      street_address: `${100 + i * 10} ${streets[i % streets.length]}`,
      zone: ["Downtown", "Gaslamp", "Core"][i % 3],
      rate_range: ["$1.25/hr", "$1.50/hr", "$2.00/hr", "Free (2hr)"][i % 4],
    });
  }
  return meters.sort((a, b) => b.availability - a.availability);
}

const SAMPLE_RECOMMENDATION = `Your best bet is the meters on 5th Ave near Market St — historically around 68% available on weekend evenings at this hour. They're a 2-minute walk and run $1.25/hr.

⚠️ The Broadway corridor has moderate citation risk after 6pm — enforcement patrols regularly there.

💡 Tip: Free 2-hour street parking opens up on Island Ave after 6pm, about a 4-minute walk south.`;

// ── Location Search (Nominatim geocoder, bounded to San Diego) ─────────────────
const SD_VIEWBOX = "-117.4,33.2,-116.9,32.53"; // west,north,east,south

function LocationSearch({ onSelect, userLocation, onClear }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (query.length < 3) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({
          format: "json", q: query, countrycodes: "us",
          viewbox: SD_VIEWBOX, bounded: "0", limit: "5",
        });
        const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
          headers: { "User-Agent": "SDSmartPark/1.0" },
        });
        setResults(await res.json());
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setResults([]);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (userLocation) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          flex: 1, fontSize: 11, color: "#93c5fd", padding: "7px 10px",
          background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.25)",
          borderRadius: 7, fontFamily: "monospace", overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          ◎ {userLocation.label}
        </div>
        <button
          onClick={onClear}
          style={{
            fontSize: 11, padding: "7px 10px", background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7,
            color: "rgba(255,255,255,0.5)", cursor: "pointer", fontFamily: "inherit",
          }}
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }} ref={containerRef}>
      <div style={{ position: "relative" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search address or landmark…"
          style={{
            width: "100%", padding: "8px 36px 8px 12px",
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 7, color: "#e2e8f0", fontSize: 12,
            fontFamily: "inherit", outline: "none", boxSizing: "border-box",
          }}
        />
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "rgba(255,255,255,0.25)", pointerEvents: "none" }}>
          {searching ? "…" : "⌕"}
        </span>
      </div>
      {results.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 9999,
          background: "rgba(8,15,24,0.98)", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
        }}>
          {results.map((r, i) => {
            const label = r.display_name.split(",").slice(0, 3).join(",").trim();
            return (
              <div
                key={i}
                onClick={() => {
                  onSelect({ lat: parseFloat(r.lat), lon: parseFloat(r.lon), label: r.display_name.split(",").slice(0, 2).join(",").trim() });
                  setQuery("");
                  setResults([]);
                }}
                style={{
                  padding: "10px 14px", fontSize: 11, color: "#e2e8f0",
                  cursor: "pointer", borderBottom: i < results.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                  fontFamily: "monospace", lineHeight: 1.4,
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(59,130,246,0.15)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                {label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Markdown renderer ──────────────────────────────────────────────────────────
function renderInline(text) {
  // Handle **bold**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} style={{ color: "#e2e8f0", fontWeight: 600 }}>{part.slice(2, -2)}</strong>
      : part
  );
}

function parseTableRows(lines) {
  return lines.map((line) =>
    line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim())
  );
}

function MarkdownText({ text }) {
  if (!text) return null;
  const lines = text.split("\n");
  const elements = [];
  let listItems = [];
  let tableLines = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    elements.push(
      <ul key={`ul-${elements.length}`} style={{ margin: "6px 0", paddingLeft: 18 }}>
        {listItems.map((item, i) => (
          <li key={i} style={{ marginBottom: 3, color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
            {renderInline(item)}
          </li>
        ))}
      </ul>
    );
    listItems = [];
  };

  const flushTable = () => {
    if (tableLines.length < 2) {
      tableLines.forEach((l) => elements.push(<p key={`tp-${elements.length}`} style={{ margin: "4px 0", color: "rgba(255,255,255,0.75)" }}>{renderInline(l)}</p>));
      tableLines = [];
      return;
    }
    const [headerLine, , ...bodyLines] = tableLines; // skip separator line
    const headers = parseTableRows([headerLine])[0];
    const rows = parseTableRows(bodyLines);
    elements.push(
      <div key={`tbl-${elements.length}`} style={{ overflowX: "auto", margin: "10px 0" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11, fontFamily: "monospace" }}>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} style={{
                  padding: "5px 10px", textAlign: "left", fontWeight: 600,
                  color: "#93c5fd", borderBottom: "1px solid rgba(96,165,250,0.3)",
                  whiteSpace: "nowrap",
                }}>{renderInline(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{
                    padding: "4px 10px", color: "rgba(255,255,255,0.75)",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                  }}>{renderInline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableLines = [];
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();

    // Table row detection
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      flushList();
      tableLines.push(trimmed);
      return;
    } else if (tableLines.length > 0) {
      flushTable();
    }

    if (!trimmed) {
      flushList();
      return;
    }
    if (trimmed.startsWith("### ")) {
      flushList();
      elements.push(<div key={i} style={{ fontSize: 11, fontWeight: 700, color: "#93c5fd", marginTop: 10, marginBottom: 3, letterSpacing: "0.04em" }}>{renderInline(trimmed.slice(4))}</div>);
    } else if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(<div key={i} style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa", marginTop: 10, marginBottom: 3 }}>{renderInline(trimmed.slice(3))}</div>);
    } else if (trimmed.startsWith("# ")) {
      flushList();
      elements.push(<div key={i} style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginTop: 10, marginBottom: 4 }}>{renderInline(trimmed.slice(2))}</div>);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      listItems.push(trimmed.slice(2));
    } else {
      flushList();
      elements.push(<p key={i} style={{ margin: "4px 0", color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>{renderInline(trimmed)}</p>);
    }
  });
  flushList();
  flushTable();
  return <div>{elements}</div>;
}

// ── Map Components ─────────────────────────────────────────────────────────────
function MapController({ centerLat, centerLon, selectedMeter, userLocation }) {
  const map = useMap();
  useEffect(() => { map.setView([centerLat, centerLon], 15); }, [centerLat, centerLon]);
  useEffect(() => {
    if (userLocation) map.setView([userLocation.lat, userLocation.lon], 16);
  }, [userLocation?.lat, userLocation?.lon]);
  useEffect(() => {
    if (selectedMeter) map.setView([selectedMeter.lat, selectedMeter.lon], 17);
  }, [selectedMeter?.meter_id]);
  return null;
}

function ParkingMap({ meters, centerLat, centerLon, onSelectMeter, selectedMeter, userLocation, hotspots = [], showHotspots = false }) {
  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
      <MapContainer
        center={[centerLat, centerLon]}
        zoom={15}
        style={{ height: 380, width: "100%" }}
        zoomControl={true}
      >
        {/* CartoDB Dark Matter — free, no API key */}
        <TileLayer
          url="https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={19}
        />

        <MapController centerLat={centerLat} centerLon={centerLon} selectedMeter={selectedMeter} userLocation={userLocation} />

        {/* Citation hotspot overlay — rendered first so meter dots appear on top */}
        {showHotspots && hotspots.map((h, i) => (
          <CircleMarker
            key={`hs-${i}`}
            center={[h.lat, h.lon]}
            radius={12 + h.density * 22}
            fillColor="#ef4444"
            color="transparent"
            fillOpacity={0.08 + h.density * 0.22}
            interactive={true}
          >
            <Tooltip sticky>
              <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                <div style={{ fontWeight: 700, color: "#ef4444" }}>Citation Hotspot</div>
                <div>Risk: {Math.round(h.avg_citation_prob * 100)}%</div>
                {h.avg_fine > 0 && <div>Avg fine: ${Math.round(h.avg_fine)}</div>}
                <div style={{ color: "rgba(255,255,255,0.4)" }}>{h.count} meter{h.count !== 1 ? "s" : ""} in zone</div>
              </div>
            </Tooltip>
          </CircleMarker>
        ))}

        {/* User location pin */}
        {userLocation && (
          <CircleMarker
            center={[userLocation.lat, userLocation.lon]}
            radius={9}
            fillColor="#3b82f6"
            color="#ffffff"
            weight={2.5}
            fillOpacity={1}
          >
            <Tooltip permanent direction="top" offset={[0, -10]}>
              <span style={{ fontSize: 10 }}>◎ {userLocation.label}</span>
            </Tooltip>
          </CircleMarker>
        )}

        {meters.map((m) => {
          const color = availColor(m.availability);
          const isSelected = selectedMeter?.meter_id === m.meter_id;
          const risk = riskLabel(m.citation_prob, m.avg_fine);
          return (
            <CircleMarker
              key={m.meter_id}
              center={[m.lat, m.lon]}
              radius={isSelected ? 10 : 6}
              fillColor={color}
              color={isSelected ? "#fff" : color}
              weight={isSelected ? 2 : 1}
              fillOpacity={0.9}
              eventHandlers={{ click: () => onSelectMeter(m) }}
            >
              <Tooltip sticky>
                <div style={{ fontSize: 12, lineHeight: 1.7, minWidth: 180 }}>
                  <div style={{ fontWeight: 700, color: "#f1f5f9", marginBottom: 2 }}>
                    {m.street_address || m.meter_id}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>
                    ID: {m.meter_id}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                    <span style={{ color: availColor(m.availability), fontWeight: 600 }}>
                      {Math.round(m.availability * 100)}% · {availLabel(m.availability)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.8 }}>
                    {m.zone && <div>Zone: {m.zone}</div>}
                    {m.rate_range && <div>Rate: {m.rate_range}</div>}
                    {m.time_start && m.time_end && <div>Hours: {m.time_start}–{m.time_end}</div>}
                    {m.time_limit && <div>Limit: {m.time_limit}</div>}
                    {m.days_in_operation && <div>Days: {m.days_in_operation}</div>}
                    <div style={{ color: risk.color }}>{risk.text}</div>
                    {m.distance_m != null && <div>Distance: {m.distance_m}m</div>}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

// ── Shared hook: fetch availability curve for a meter ─────────────────────────
function useAvailCurve(meterId) {
  const [byHour, setByHour] = useState(null); // { dow -> { hour -> avail } }

  useEffect(() => {
    setByHour(null);
    fetch(`${API_BASE}/meter/${meterId}/curve`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        const map = {};
        for (const e of data.curve) {
          if (!map[e.dow]) map[e.dow] = {};
          map[e.dow][e.hour] = e.avail;
        }
        setByHour(map);
      })
      .catch(() => null);
  }, [meterId]);

  return byHour;
}

function hourLabel(h) {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

// ── Compact sparkline for meter cards (full 24h, hoverable) ───────────────────
function AvailSparkline({ meter, selectedDow, selectedHour }) {
  const hours = Array.from({ length: 24 }, (_, i) => i); // 0–23
  const byHour = useAvailCurve(meter.meter_id);
  const [hoverIdx, setHoverIdx] = useState(null);

  const dayData = byHour?.[selectedDow] ?? null;
  const displayCurve = hours.map((h) =>
    dayData ? (dayData[h] ?? meter.availability) : (() => {
      const noise = Math.sin(h * 0.8 + meter.lat * 100) * 0.15;
      return Math.max(0.05, Math.min(0.95, meter.availability + noise));
    })()
  );

  const W = 200, H = 36;
  const xOf = (i) => (i / (hours.length - 1)) * W;
  const yOf = (v) => H - v * H;
  const pts = displayCurve.map((v, i) => `${xOf(i)},${yOf(v)}`).join(" ");
  const color = availColor(meter.availability);
  const nowX = xOf(selectedHour);

  const hoverH = hoverIdx !== null ? hours[hoverIdx] : null;
  const hoverV = hoverIdx !== null ? displayCurve[hoverIdx] : null;

  return (
    <div style={{ marginTop: 8, position: "relative" }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4, fontFamily: "monospace" }}>
        {DOW_NAMES[selectedDow]} — AVAILABILITY (24H)
      </div>
      <svg
        width={W} height={H}
        style={{ overflow: "visible", cursor: "crosshair", display: "block" }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const idx = Math.round((x / W) * (hours.length - 1));
          setHoverIdx(Math.max(0, Math.min(hours.length - 1, idx)));
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={`sg_${meter.meter_id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon
          points={`0,${H} ${pts} ${W},${H}`}
          fill={`url(#sg_${meter.meter_id})`}
        />
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
        {/* Selected hour line */}
        <line x1={nowX} y1={0} x2={nowX} y2={H} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="2,2" />
        {/* Hover */}
        {hoverIdx !== null && (
          <>
            <line x1={xOf(hoverIdx)} y1={0} x2={xOf(hoverIdx)} y2={H} stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
            <circle cx={xOf(hoverIdx)} cy={yOf(hoverV)} r={3} fill={color} />
            <rect x={Math.min(xOf(hoverIdx) + 4, W - 64)} y={yOf(hoverV) - 18} width={60} height={16} rx={3} fill="rgba(15,23,42,0.9)" />
            <text x={Math.min(xOf(hoverIdx) + 7, W - 61)} y={yOf(hoverV) - 6} fill="#e2e8f0" fontSize={9} fontFamily="monospace">
              {hourLabel(hoverH)} · {Math.round(hoverV * 100)}%
            </text>
          </>
        )}
        {/* X axis labels every 6h */}
        {[0, 6, 12, 18, 23].map((h) => (
          <text key={h} x={xOf(h)} y={H + 11} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={8} fontFamily="monospace">
            {hourLabel(h)}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ── Full availability chart for selected meter detail panel ───────────────────
function AvailChart({ meter, selectedDow, selectedHour }) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const byHour = useAvailCurve(meter.meter_id);
  const [hoverIdx, setHoverIdx] = useState(null);

  const dayData = byHour?.[selectedDow] ?? null;
  const displayCurve = hours.map((h) =>
    dayData ? (dayData[h] ?? meter.availability) : (() => {
      const noise = Math.sin(h * 0.8 + meter.lat * 100) * 0.15;
      return Math.max(0.05, Math.min(0.95, meter.availability + noise));
    })()
  );

  const PAD = { top: 12, right: 8, bottom: 28, left: 36 };
  const W = 420, H = 130;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const xOf = (i) => PAD.left + (i / (hours.length - 1)) * innerW;
  const yOf = (v) => PAD.top + (1 - v) * innerH;

  const pts = displayCurve.map((v, i) => `${xOf(i)},${yOf(v)}`).join(" ");
  const color = availColor(meter.availability);
  const yTicks = [0, 0.25, 0.5, 0.75, 1.0];

  const hoverV = hoverIdx !== null ? displayCurve[hoverIdx] : null;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, fontFamily: "monospace" }}>
        {DOW_NAMES[selectedDow]} — AVAILABILITY (24H)
      </div>
      <svg
        width="100%" viewBox={`0 0 ${W} ${H}`}
        style={{ overflow: "visible", cursor: "crosshair" }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const scaleX = W / rect.width;
          const x = (e.clientX - rect.left) * scaleX - PAD.left;
          const idx = Math.round((x / innerW) * (hours.length - 1));
          setHoverIdx(Math.max(0, Math.min(hours.length - 1, idx)));
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={`cg_${meter.meter_id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Y-axis grid + labels */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left} y1={yOf(v)} x2={PAD.left + innerW} y2={yOf(v)}
              stroke="rgba(255,255,255,0.07)" strokeWidth={1}
            />
            <text x={PAD.left - 4} y={yOf(v) + 4} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize={9} fontFamily="monospace">
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}

        {/* Area fill */}
        <polygon
          points={`${xOf(0)},${yOf(0)} ${pts} ${xOf(hours.length - 1)},${yOf(0)}`}
          fill={`url(#cg_${meter.meter_id})`}
        />

        {/* Line */}
        <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />

        {/* Selected hour line */}
        <line
          x1={xOf(selectedHour)} y1={PAD.top} x2={xOf(selectedHour)} y2={PAD.top + innerH}
          stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="3,3"
        />
        <text x={xOf(selectedHour)} y={PAD.top - 3} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize={8} fontFamily="monospace">
          {hourLabel(selectedHour)}
        </text>

        {/* Hover */}
        {hoverIdx !== null && (
          <>
            <line
              x1={xOf(hoverIdx)} y1={PAD.top} x2={xOf(hoverIdx)} y2={PAD.top + innerH}
              stroke="rgba(255,255,255,0.45)" strokeWidth={1}
            />
            <circle cx={xOf(hoverIdx)} cy={yOf(hoverV)} r={4} fill={color} stroke="#080f18" strokeWidth={1.5} />
            <rect
              x={Math.min(xOf(hoverIdx) + 6, PAD.left + innerW - 74)} y={yOf(hoverV) - 20}
              width={70} height={18} rx={4} fill="rgba(15,23,42,0.95)"
            />
            <text
              x={Math.min(xOf(hoverIdx) + 9, PAD.left + innerW - 71)} y={yOf(hoverV) - 7}
              fill="#e2e8f0" fontSize={10} fontFamily="monospace"
            >
              {hourLabel(hours[hoverIdx])} · {Math.round(hoverV * 100)}%
            </text>
          </>
        )}

        {/* X axis labels every 6h */}
        {[0, 6, 12, 18, 23].map((h) => (
          <text key={h} x={xOf(h)} y={PAD.top + innerH + 14} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize={9} fontFamily="monospace">
            {hourLabel(h)}
          </text>
        ))}

        {/* Y axis border */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + innerH} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
        <line x1={PAD.left} y1={PAD.top + innerH} x2={PAD.left + innerW} y2={PAD.top + innerH} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
      </svg>
    </div>
  );
}

// ── Meter Card ─────────────────────────────────────────────────────────────────
function MeterCard({ meter, isSelected, onClick, selectedDow, selectedHour }) {
  const risk = riskLabel(meter.citation_prob, meter.avg_fine);
  const avail = meter.availability;

  return (
    <div
      onClick={onClick}
      style={{
        padding: "14px 16px",
        borderRadius: 10,
        background: isSelected ? "rgba(96,165,250,0.08)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${isSelected ? "rgba(96,165,250,0.3)" : "rgba(255,255,255,0.07)"}`,
        cursor: "pointer",
        transition: "all 0.15s ease",
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", fontFamily: "monospace" }}>
            {meter.street_address || meter.meter_id}
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 1, fontFamily: "monospace" }}>
            {meter.meter_id}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
            {meter.zone} · {meter.rate_range || "Rate unknown"} · {meter.distance_m}m walk
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{
            fontSize: 20, fontWeight: 700,
            color: availColor(avail),
            fontFamily: "monospace", lineHeight: 1
          }}>
            {Math.round(avail * 100)}%
          </div>
          <div style={{ fontSize: 9, color: availColor(avail), marginTop: 1 }}>
            {availLabel(avail)}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{
          fontSize: 9, padding: "2px 7px", borderRadius: 4,
          background: "rgba(255,255,255,0.05)",
          color: risk.color, border: `1px solid ${risk.color}40`,
          fontFamily: "monospace"
        }}>
          {risk.text}
        </span>
        {meter.time_start && meter.time_end && (
          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)", fontFamily: "monospace" }}>
            {meter.time_start}–{meter.time_end}
          </span>
        )}
        {meter.time_limit && (
          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)", fontFamily: "monospace" }}>
            {meter.time_limit}
          </span>
        )}
        {meter.days_in_operation && (
          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)", fontFamily: "monospace" }}>
            {meter.days_in_operation}
          </span>
        )}
      </div>

      {isSelected && <AvailSparkline meter={meter} selectedDow={selectedDow} selectedHour={selectedHour} />}
    </div>
  );
}

// ── Chat Panel ────────────────────────────────────────────────────────────────
function ChatPanel() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  const SUGGESTIONS = [
    "Which area has the highest citation risk?",
    "Where's the best parking right now?",
    "How risky is parking in Gaslamp on Friday night?",
    "Which neighbourhoods have the most available parking on weekends?",
    "What's the safest area to park with the lowest fine risk?",
  ];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, loading]);

  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg) return;
    setInput("");
    const newHistory = [...history, { role: "user", content: msg }];
    setHistory(newHistory);
    setLoading(true);
    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history }),
      });
      const data = await res.json();
      setHistory(data.history);
    } catch {
      setHistory([...newHistory, { role: "assistant", content: "Something went wrong. Is the backend running?" }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12 }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em" }}>
        ASK CLAUDE — POWERED BY LIVE SD PARKING DATA
      </div>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingRight: 4, minHeight: 0 }}>
        {history.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>Try asking:</div>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} style={{
                textAlign: "left", background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8,
                padding: "8px 12px", color: "rgba(255,255,255,0.55)", fontSize: 11, cursor: "pointer",
              }}>{s}</button>
            ))}
          </div>
        )}
        {history.map((msg, i) => (
          <div key={i} style={{ display: "flex", flexDirection: msg.role === "user" ? "row-reverse" : "row", gap: 8, alignItems: "flex-start" }}>
            <div style={{
              fontSize: 9, padding: "2px 6px", borderRadius: 4, marginTop: 2, flexShrink: 0,
              background: msg.role === "user" ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.06)",
              color: msg.role === "user" ? "#60a5fa" : "rgba(255,255,255,0.3)", letterSpacing: "0.06em",
            }}>{msg.role === "user" ? "YOU" : "AI"}</div>
            <div style={{
              flex: 1, padding: "10px 12px", borderRadius: 10, fontSize: 12, lineHeight: 1.65,
              background: msg.role === "user" ? "rgba(59,130,246,0.1)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${msg.role === "user" ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.07)"}`,
              color: msg.role === "user" ? "#bfdbfe" : "#e2e8f0",
            }}>
              {msg.role === "assistant" ? <MarkdownText text={msg.content} /> : msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, marginTop: 2, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)", letterSpacing: "0.06em" }}>AI</div>
            <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: 5, alignItems: "center" }}>
              {[0, 0.2, 0.4].map((delay) => (
                <div key={delay} style={{ width: 6, height: 6, borderRadius: "50%", background: "#60a5fa", animation: "pulse 1.2s ease-in-out infinite", animationDelay: `${delay}s` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Ask anything about SD parking..."
          style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "9px 12px", color: "#e2e8f0", fontSize: 12, outline: "none", fontFamily: "inherit" }}
        />
        <button onClick={() => send()} disabled={loading || !input.trim()} style={{
          padding: "9px 16px", borderRadius: 8, fontSize: 11, cursor: "pointer", letterSpacing: "0.05em",
          background: loading || !input.trim() ? "rgba(255,255,255,0.05)" : "rgba(59,130,246,0.8)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: loading || !input.trim() ? "rgba(255,255,255,0.3)" : "#fff",
        }}>SEND</button>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [query, setQuery] = useState("");
  const [areas, setAreas] = useState([]);
  const [selectedNeighborhood, setSelectedNeighborhood] = useState(null);
  const [meters, setMeters] = useState([]);       // search results for left panel
  const [mapMeters, setMapMeters] = useState([]); // all area meters for map
  const [chatHistory, setChatHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedMeter, setSelectedMeter] = useState(null);
  const [usingSampleData, setUsingSampleData] = useState(false);
  const [resolvedLocation, setResolvedLocation] = useState(null); // { area, reasoning }
  const selectedAreaRef = useCallback((node) => { if (node) node.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [selectedNeighborhood]);

  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dayStr = DOW_NAMES[now.getDay() === 0 ? 6 : now.getDay() - 1];
  const nowDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const nowHour = now.getHours();

  const [selectedDow, setSelectedDow] = useState(nowDow);
  const [selectedHour, setSelectedHour] = useState(nowHour);
  const isNow = selectedDow === nowDow && selectedHour === nowHour;

  const [userLocation, setUserLocation] = useState(null); // { lat, lon, label }
  const [hotspots, setHotspots] = useState([]);
  const [showHotspots, setShowHotspots] = useState(false);
  const [leftWidth, setLeftWidth] = useState(380);
  const isDragging = useRef(false);

  const handleLocationSelect = useCallback(async (loc) => {
    setUserLocation(loc);

    // Auto-select the nearest area by straight-line distance to centroid
    if (areas.length > 0) {
      const nearest = areas.reduce((best, a) => {
        if (a.lat == null) return best;
        const d = (a.lat - loc.lat) ** 2 + (a.lon - loc.lon) ** 2;
        return !best || d < best.d ? { area: a, d } : best;
      }, null)?.area;
      if (nearest) setSelectedNeighborhood(nearest);
    }

    // Immediately show top-10 meters nearest to the user's location (no Claude needed)
    try {
      const res = await fetch(
        `${API_BASE}/meters/area?lat=${loc.lat}&lon=${loc.lon}&radius_m=800&limit=10&dow=${selectedDow}&hour=${selectedHour}`
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setMeters(data);
          setChatHistory([]);
          setUsingSampleData(false);
        }
      }
    } catch { /* silently ignore */ }
  }, [areas, selectedDow, selectedHour]);

  const handleLocationClear = useCallback(() => {
    setUserLocation(null);
    setMeters([]);
    setChatHistory([]);
  }, []);

  const handleAreaSelect = useCallback((area) => {
    setUserLocation(null);      // clear address pin — area is now the active location
    setSelectedNeighborhood(area);
    setMeters([]);
    setChatHistory([]);
  }, []);

  // Load areas from API on mount
  useEffect(() => {
    fetch(`${API_BASE}/areas`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setAreas(data);
          setSelectedNeighborhood(data[0]);
        }
      })
      .catch(() => {});
  }, []);

  // Load citation hotspots once on mount
  useEffect(() => {
    fetch(`${API_BASE}/citation-hotspots`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { if (Array.isArray(data)) setHotspots(data); })
      .catch(() => {});
  }, []);

  // Map meters always follow the selected area centroid (so area change always refreshes the map)
  useEffect(() => {
    if (!selectedNeighborhood) return;
    const { lat, lon } = selectedNeighborhood;
    fetch(`${API_BASE}/meters/area?lat=${lat}&lon=${lon}&radius_m=1500&limit=500&dow=${selectedDow}&hour=${selectedHour}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setMapMeters(Array.isArray(data) ? data : []))
      .catch(() => setMapMeters([]));
    setSelectedMeter(null);
  }, [selectedNeighborhood, selectedDow, selectedHour]);

  const handleSearch = useCallback(async (overrideQuery) => {
    const q = (overrideQuery || query).trim();
    if (!q) return;
    setLoading(true);
    setSelectedMeter(null);
    setResolvedLocation(null);

    // Optimistically append user message to chat
    const userMsg = { role: "user", content: q };
    setChatHistory((prev) => [...prev, userMsg]);
    if (!overrideQuery) setQuery("");

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, history: chatHistory }),
      });

      if (!res.ok) throw new Error("API error");
      const data = await res.json();

      // Update chat history with assistant reply
      setChatHistory(data.history);

      // If Claude found meters, update the map
      if (data.meters && data.meters.length > 0) {
        setMeters(data.meters);
        setMapMeters(data.meters);
        setUsingSampleData(false);
        // Update time selectors if Claude inferred day/time
        if (data.query_time) {
          setSelectedDow(data.query_time.dow);
          setSelectedHour(data.query_time.hour);
        }
        // Pan map to location if returned
        if (data.location) {
          const nearest = areas.reduce((best, a) => {
            if (!a.lat) return best;
            const d = (a.lat - data.location.lat) ** 2 + (a.lon - data.location.lon) ** 2;
            return !best || d < best.d ? { area: a, d } : best;
          }, null)?.area;
          if (nearest) setSelectedNeighborhood(nearest);
        }
      } else if (!data.meters || data.meters.length === 0) {
        // Analytical answer — keep existing map, no meter update needed
      }
      setUsingSampleData(false);
    } catch {
      setChatHistory((prev) => [...prev, { role: "assistant", content: "Something went wrong — is the backend running?" }]);
      setUsingSampleData(true);
    } finally {
      setLoading(false);
    }
  }, [query, chatHistory, areas, selectedNeighborhood]);

  // Selecting a meter — unified handler for both list and map clicks
  const handleSelectMeter = useCallback((m) => {
    setSelectedMeter((prev) => prev?.meter_id === m.meter_id ? null : m);
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSearch();
  };

  // Quick searches
  const QUICK = [
    "Padres game tonight",
    "Dinner in Little Italy",
    "Weekend brunch Hillcrest",
    "Quick errand downtown",
    "Which area has the highest citation risk?",
    "Best parking in the city right now",
  ];

  return (
    <>
    <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    <div style={{
      minHeight: "100vh",
      background: "#080f18",
      color: "#e2e8f0",
      fontFamily: "'DM Mono', 'Fira Code', 'Courier New', monospace",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        padding: "16px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(255,255,255,0.02)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #1d4ed8, #0ea5e9)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16,
          }}>🅿️</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.05em", color: "#f1f5f9" }}>
              SD SMART PARK
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
              POWERED BY CITY OF SAN DIEGO OPEN DATA + CLAUDE AI
            </div>
          </div>
        </div>
        <div style={{
          fontSize: 11, color: "rgba(255,255,255,0.3)",
          background: "rgba(255,255,255,0.04)",
          padding: "4px 10px", borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.07)"
        }}>
          {dayStr} · {timeStr}
        </div>
      </div>

      {/* Body */}
      <div style={{
        display: "flex", flex: 1,
        flexDirection: window.innerWidth < 900 ? "column" : "row",
        overflow: "hidden",
      }}>
        {/* Left Panel */}
        <div style={{
          width: window.innerWidth < 900 ? "100%" : leftWidth,
          minWidth: 280, maxWidth: "70vw",
          borderRight: "1px solid rgba(255,255,255,0.07)",
          padding: "20px",
          display: "flex", flexDirection: "column", gap: 16,
          overflowY: "auto",
          flexShrink: 0,
        }}>
          {/* Location Search — top of panel */}
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: "0.08em" }}>
              YOUR LOCATION
            </div>
            <LocationSearch
              userLocation={userLocation}
              onSelect={handleLocationSelect}
              onClear={handleLocationClear}
            />
            {!userLocation && (
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 6, fontFamily: "monospace" }}>
                Search an address to see nearest meters · area used as default
              </div>
            )}
          </div>

          {/* Area Selector */}
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: "0.08em", display: "flex", justifyContent: "space-between" }}>
              <span>AREA</span>
              {areas.length > 0 && <span style={{ color: "rgba(255,255,255,0.2)" }}>{areas.length} areas</span>}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 120, overflowY: "auto" }}>
              {areas.map((n) => (
                <button
                  key={n.name}
                  ref={selectedNeighborhood?.name === n.name ? selectedAreaRef : null}
                  onClick={() => handleAreaSelect(n)}
                  style={{
                    fontSize: 10, padding: "4px 10px", borderRadius: 6,
                    background: selectedNeighborhood?.name === n.name
                      ? "rgba(59,130,246,0.3)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${selectedNeighborhood?.name === n.name
                      ? "rgba(59,130,246,0.6)" : "rgba(255,255,255,0.08)"}`,
                    color: selectedNeighborhood?.name === n.name ? "#93c5fd" : "rgba(255,255,255,0.5)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.15s",
                  }}
                >
                  {n.name}
                  <span style={{ marginLeft: 4, fontSize: 8, opacity: 0.5 }}>{n.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Day & Time Picker */}
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: "0.08em", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>DAY & TIME</span>
              {!isNow && (
                <button
                  onClick={() => { setSelectedDow(nowDow); setSelectedHour(nowHour); }}
                  style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", color: "#93c5fd", cursor: "pointer", fontFamily: "inherit" }}
                >
                  ↩ now
                </button>
              )}
            </div>
            {/* DOW buttons */}
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              {DOW_NAMES.map((d, i) => (
                <button
                  key={d}
                  onClick={() => setSelectedDow(i)}
                  style={{
                    flex: 1, fontSize: 9, padding: "4px 2px", borderRadius: 5,
                    background: selectedDow === i ? "rgba(59,130,246,0.3)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${selectedDow === i ? "rgba(59,130,246,0.6)" : "rgba(255,255,255,0.08)"}`,
                    color: selectedDow === i ? "#93c5fd" : "rgba(255,255,255,0.4)",
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {d}
                </button>
              ))}
            </div>
            {/* Hour slider */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="range" min={0} max={23} value={selectedHour}
                onChange={(e) => setSelectedHour(Number(e.target.value))}
                style={{ flex: 1, accentColor: "#3b82f6", cursor: "pointer" }}
              />
              <span style={{ fontSize: 12, fontFamily: "monospace", color: "#e2e8f0", minWidth: 36, textAlign: "right" }}>
                {hourLabel(selectedHour)}
              </span>
            </div>
          </div>

          {/* Search */}
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: "0.08em" }}>
              WHERE ARE YOU HEADING?
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder='e.g. "Dinner at 7pm in Gaslamp"'
                style={{
                  flex: 1, padding: "10px 14px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8, color: "#e2e8f0",
                  fontSize: 12, fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <button
                onClick={() => handleSearch()}
                disabled={loading || !query.trim()}
                style={{
                  padding: "10px 16px",
                  background: loading ? "rgba(59,130,246,0.2)" : "rgba(59,130,246,0.8)",
                  border: "none", borderRadius: 8,
                  color: "#fff", fontSize: 12, cursor: "pointer",
                  fontFamily: "inherit", fontWeight: 600,
                  transition: "all 0.15s",
                  minWidth: 60,
                }}
              >
                {loading ? "..." : "GO"}
              </button>
            </div>

            {/* Quick searches */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
              {QUICK.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSearch(q)}
                  style={{
                    fontSize: 9, padding: "3px 8px", borderRadius: 4,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    color: "rgba(255,255,255,0.35)", cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Resolved location badge */}
            {resolvedLocation && (
              <div style={{
                marginTop: 8, padding: "6px 10px",
                background: "rgba(16,185,129,0.08)",
                border: "1px solid rgba(16,185,129,0.25)",
                borderRadius: 6,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <span style={{ fontSize: 10, color: "#34d399" }}>⌖</span>
                <span style={{ fontSize: 10, color: "#34d399", fontWeight: 600 }}>
                  {resolvedLocation.location_name || resolvedLocation.area.name}
                </span>
                {resolvedLocation.location_name && (
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.45)" }}>
                    → nearest area: {resolvedLocation.area.name}
                  </span>
                )}
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", flex: 1 }}>
                  — {resolvedLocation.reasoning}
                </span>
              </div>
            )}
          </div>

          {/* Conversation thread */}
          {(loading || chatHistory.length > 0) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 400, overflowY: "auto" }}>
              <div style={{ fontSize: 9, letterSpacing: "0.1em", color: "#60a5fa", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                ✦ CLAUDE
                {loading && (
                  <span style={{ display: "inline-flex", gap: 3, marginLeft: 2 }}>
                    {[0, 1, 2].map((i) => (
                      <span key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: "#60a5fa", animation: "pulse 1.2s ease-in-out infinite", animationDelay: `${i * 0.2}s`, display: "inline-block" }} />
                    ))}
                  </span>
                )}
                <span style={{ marginLeft: "auto" }}>
                  <button
                    onClick={() => { setChatHistory([]); setMeters([]); setResolvedLocation(null); }}
                    style={{
                      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                      color: "rgba(255,255,255,0.5)", fontSize: 9, padding: "2px 8px",
                      borderRadius: 4, cursor: "pointer", letterSpacing: "0.05em",
                    }}
                    onMouseEnter={(e) => { e.target.style.background = "rgba(255,255,255,0.12)"; e.target.style.color = "#fff"; }}
                    onMouseLeave={(e) => { e.target.style.background = "rgba(255,255,255,0.06)"; e.target.style.color = "rgba(255,255,255,0.5)"; }}
                  >
                    CLEAR CHAT
                  </button>
                </span>
              </div>
              {chatHistory.map((msg, i) => (
                <div key={i} style={{
                  padding: "10px 12px", borderRadius: 10, fontSize: 12, lineHeight: 1.65,
                  background: msg.role === "user" ? "rgba(255,255,255,0.04)" : "rgba(59,130,246,0.07)",
                  border: `1px solid ${msg.role === "user" ? "rgba(255,255,255,0.07)" : "rgba(59,130,246,0.2)"}`,
                  color: msg.role === "user" ? "rgba(255,255,255,0.5)" : "#e2e8f0",
                }}>
                  {msg.role === "assistant" ? <MarkdownText text={msg.content} /> : msg.content}
                </div>
              ))}
              {loading && (
                <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.15)", display: "flex", gap: 5 }}>
                  {[0, 0.2, 0.4].map((d) => (<div key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: "#60a5fa", animation: "pulse 1.2s ease-in-out infinite", animationDelay: `${d}s` }} />))}
                </div>
              )}
            </div>
          )}

          {/* Meter list — search results */}
          {meters.length > 0 && (
            <div>
              <div style={{
                fontSize: 10, color: "rgba(255,255,255,0.4)",
                marginBottom: 8, letterSpacing: "0.08em",
                display: "flex", justifyContent: "space-between"
              }}>
                <span>NEARBY METERS</span>
                <span style={{ color: "rgba(255,255,255,0.25)" }}>
                  {meters.length} matched · {mapMeters.length} in area
                </span>
              </div>
              <div style={{ maxHeight: 380, overflowY: "auto" }}>
                {meters.slice(0, 12).map((m) => (
                  <MeterCard
                    key={m.meter_id}
                    meter={m}
                    isSelected={selectedMeter?.meter_id === m.meter_id}
                    onClick={() => handleSelectMeter(m)}
                    selectedDow={selectedDow}
                    selectedHour={selectedHour}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={(e) => {
            isDragging.current = true;
            const startX = e.clientX;
            const startW = leftWidth;
            const onMove = (ev) => {
              if (!isDragging.current) return;
              const delta = ev.clientX - startX;
              setLeftWidth(Math.min(Math.max(startW + delta, 280), window.innerWidth * 0.7));
            };
            const onUp = () => { isDragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
          style={{
            width: 6, cursor: "col-resize", flexShrink: 0,
            background: "rgba(255,255,255,0.04)",
            borderLeft: "1px solid rgba(255,255,255,0.06)",
            borderRight: "1px solid rgba(255,255,255,0.06)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "rgba(59,130,246,0.25)"}
          onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
        />
        {/* Right Panel — Map */}
        <div style={{
          flex: 1, padding: "20px",
          display: "flex", flexDirection: "column", gap: 16,
        }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em" }}>
            MAP VIEW — {selectedNeighborhood ? selectedNeighborhood.name.toUpperCase() : "LOADING..."}
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            {[
              { color: "#22c55e", label: "Likely Available (65%+)" },
              { color: "#f59e0b", label: "Moderate (35-65%)" },
              { color: "#ef4444", label: "Usually Full (<35%)" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                {label}
              </div>
            ))}
            {hotspots.length > 0 && (
              <button
                onClick={() => setShowHotspots((v) => !v)}
                style={{
                  marginLeft: "auto",
                  fontSize: 10, padding: "3px 10px", borderRadius: 6, cursor: "pointer",
                  border: `1px solid ${showHotspots ? "#ef4444" : "rgba(255,255,255,0.15)"}`,
                  background: showHotspots ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.04)",
                  color: showHotspots ? "#ef4444" : "rgba(255,255,255,0.4)",
                  letterSpacing: "0.05em",
                }}
              >
                {showHotspots ? "◉" : "○"} CITATION ZONES
              </button>
            )}
          </div>

          {selectedNeighborhood && <>
            <ParkingMap
              meters={mapMeters.length > 0 ? mapMeters : meters}
              centerLat={selectedNeighborhood.lat}
              centerLon={selectedNeighborhood.lon}
              onSelectMeter={handleSelectMeter}
              selectedMeter={selectedMeter}
              userLocation={userLocation}
              hotspots={hotspots}
              showHotspots={showHotspots}
            />

              {/* Stats row — sourced from mapMeters (full area data from API) */}
              {mapMeters.length > 0 && (() => {
                const src = mapMeters;
                const avgAvail = src.reduce((s, m) => s + (m.availability ?? 0), 0) / src.length;
                const bestAvail = Math.max(...src.map((m) => m.availability ?? 0));
                const highRiskCount = src.filter((m) => (m.citation_prob ?? 0) > 0.06).length;
                const highRiskPct = Math.round((highRiskCount / src.length) * 100);
                return (
                  <div style={{ display: "flex", gap: 12 }}>
                    {[
                      {
                        label: "AVG AVAILABILITY",
                        value: `${Math.round(avgAvail * 100)}%`,
                        color: availColor(avgAvail),
                      },
                      {
                        label: "BEST OPTION",
                        value: `${Math.round(bestAvail * 100)}%`,
                        color: "#22c55e",
                      },
                      {
                        label: "AREA METERS",
                        value: src.length,
                        color: "#60a5fa",
                      },
                      {
                        label: "HIGH RISK METERS",
                        value: `${highRiskPct}%`,
                        color: highRiskPct > 30 ? "#ef4444" : highRiskPct > 10 ? "#f59e0b" : "#22c55e",
                      },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{
                        flex: 1, padding: "12px 14px",
                        background: "rgba(255,255,255,0.03)",
                        borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)",
                      }}>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em" }}>{label}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Selected meter detail panel */}
              {selectedMeter && (
                <div style={{
                  padding: "16px",
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: 10,
                  border: "1px solid rgba(59,130,246,0.2)",
                }}>
                  <div style={{ fontSize: 10, color: "#60a5fa", marginBottom: 8, letterSpacing: "0.08em" }}>
                    SELECTED METER
                  </div>
                  <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
                        {selectedMeter.street_address || selectedMeter.meter_id}
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 1, fontFamily: "monospace" }}>
                        {selectedMeter.meter_id}
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4, lineHeight: 1.7 }}>
                        {selectedMeter.zone && <div>Zone: {selectedMeter.zone}</div>}
                        {selectedMeter.rate_range && <div>Rate: {selectedMeter.rate_range}</div>}
                        {selectedMeter.time_start && selectedMeter.time_end && <div>Hours: {selectedMeter.time_start}–{selectedMeter.time_end}</div>}
                        {selectedMeter.time_limit && <div>Limit: {selectedMeter.time_limit}</div>}
                        {selectedMeter.days_in_operation && <div>Days: {selectedMeter.days_in_operation}</div>}
                        {selectedMeter.distance_m != null && <div>{selectedMeter.distance_m}m away</div>}
                      </div>
                      <div style={{ fontSize: 11, color: riskLabel(selectedMeter.citation_prob, selectedMeter.avg_fine).color, marginTop: 4 }}>
                        {riskLabel(selectedMeter.citation_prob, selectedMeter.avg_fine).text}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: availColor(selectedMeter.availability), fontFamily: "monospace" }}>
                        {Math.round(selectedMeter.availability * 100)}%
                      </div>
                      <div style={{ fontSize: 10, color: availColor(selectedMeter.availability) }}>
                        {availLabel(selectedMeter.availability)}
                      </div>
                    </div>
                  </div>
                  <AvailChart meter={selectedMeter} selectedDow={selectedDow} selectedHour={selectedHour} />
                </div>
              )}
          </>}
        </div>
      </div>
    </div>
    </>
  );
}