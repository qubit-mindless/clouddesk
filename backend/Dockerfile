FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY alembic.ini ./
COPY alembic ./alembic
RUN useradd --create-home appuser
USER appuser
# SHA commita podaje pipeline CD (deploy.yml: --build-arg GIT_SHA=<sha>); widać go w /api/health.
# Na końcu pliku, żeby zmiana SHA przy każdym commicie nie unieważniała cache warstw z zależnościami i kodem.
ARG GIT_SHA=local
ENV GIT_SHA=$GIT_SHA
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
