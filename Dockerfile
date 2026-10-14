FROM python:3.11-slim

WORKDIR /app

# Copy all project files
COPY . /app

# Environment configuration
ENV PORT=8000
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["python3", "server.py"]
