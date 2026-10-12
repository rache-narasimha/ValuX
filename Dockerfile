FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SOFFICE_PATH=/usr/bin/soffice

RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-writer fonts-dejavu-core fonts-liberation fonts-crosextra-carlito \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt /tmp/requirements.txt
RUN for attempt in 1 2 3 4 5; do \
      pip install --no-cache-dir --timeout 300 --retries 10 -r /tmp/requirements.txt && exit 0; \
      echo "Dependency download failed (attempt ${attempt}/5); retrying."; \
    done; \
    exit 1

COPY backend /app/backend
COPY frontend /app/frontend
COPY resources /app/resources

EXPOSE 4173
CMD ["python", "-m", "backend.server"]
