FROM python:3.14-slim

ENV PATH="/usr/games:${PATH}"

WORKDIR /opt/scid-web

COPY . /opt/scid-web

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tcl8.6 \
        stockfish \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    fastapi \
    uvicorn

EXPOSE 8095

CMD ["uvicorn", "web.api.main:app", "--host", "0.0.0.0", "--port", "8095"]
