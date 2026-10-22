#!/usr/bin/env bash
# Exit on error
set -o errexit

echo "==> Upgrading pip..."
pip install --upgrade pip

echo "==> Installing CPU-only PyTorch (lightweight, avoids CUDA bloat)..."
pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

echo "==> Installing requirements..."
pip install -r requirements.txt

echo "==> Collecting static assets..."
python manage.py collectstatic --noinput

echo "==> Applying database migrations..."
python manage.py migrate --noinput

echo "==> Build complete!"
