# LANBridge - Containerized Local Network File Transfer
FROM python:3.11-slim

WORKDIR /app

# Prevent Python from writing .pyc and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install runtime dependencies
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy application files
COPY backend /app/backend
COPY frontend/dist /app/frontend/dist
COPY run.py /app/run.py

# Create persistent storage directories with full permissions for non-root containers
RUN mkdir -p /app/data /app/received /app/temp && chmod -R 777 /app

# Expose default HTTP / WebSocket port
EXPOSE 8000

# Run LANBridge server
CMD ["python", "run.py"]
