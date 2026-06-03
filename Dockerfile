FROM caddy:2-alpine AS caddy-bin

FROM python:3.12-alpine

RUN apk add --no-cache curl && pip install --no-cache-dir uv

COPY --from=caddy-bin /usr/bin/caddy /usr/bin/caddy

WORKDIR /app
COPY pyproject.toml .
RUN uv sync --no-dev

COPY app.py .
COPY svc/ svc/

EXPOSE 9090

CMD ["uv", "run", "app.py"]
