FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

WORKDIR /app

COPY pyproject.toml ./
COPY leadhunter_worker ./leadhunter_worker

RUN pip install --no-cache-dir '.[scrapegraph]'
RUN python -m playwright install --with-deps chromium

RUN useradd --create-home --uid 10001 leadhunter
USER leadhunter

CMD ["python", "-m", "leadhunter_worker"]
