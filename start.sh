#!/bin/bash
# Start backend and frontend concurrently

trap 'kill 0' EXIT  # kill both processes when script exits

echo "Starting SD Smart Park..."
echo "  Backend  → http://localhost:8000"
echo "  Frontend → http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both."
echo ""

poetry run uvicorn backend.main:app --reload --port 8000 &
(cd frontend && npm run dev) &

wait
