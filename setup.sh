#!/bin/bash
set -e

echo "Setting up SD Smart Park..."
echo ""

# Python dependencies
echo "[1/2] Installing Python dependencies..."
poetry install
echo ""

# Frontend dependencies
echo "[2/2] Installing frontend dependencies..."
cd frontend && npm install
cd ..

echo ""
echo "Setup complete. Run ./start.sh to launch the app."
