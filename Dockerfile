FROM python:3.11-slim

# Set working directory to backend
WORKDIR /app

# Copy only the backend subdirectory
COPY "Back_end/Clinical Decision Support System - cintana/" .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Expose default port (Railway overrides with $PORT)
EXPOSE 8000

# Start FastAPI with Railway's injected $PORT
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2
