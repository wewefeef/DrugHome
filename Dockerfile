FROM python:3.11-slim

WORKDIR /app

# JSON array form handles directory names with spaces
# Copy requirements first for Docker layer caching
COPY ["Back_end/Clinical Decision Support System - cintana/requirements.txt", "./"]

RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend source
COPY ["Back_end/Clinical Decision Support System - cintana/", "./"]

EXPOSE 8000

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2
