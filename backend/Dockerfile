# Use an official Python runtime as a parent image
FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1
ENV ENVIRONMENT=production
ENV PORT=8000

# Install system dependencies for OpenSees and SectionProperties
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgfortran5 \
    libtcl8.6 \
    liblapack3 \
    libblas3 \
    libglu1-mesa \
    libgl1 \
    libsm6 \
    libice6 \
    libxrender1 \
    libglib2.0-0 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file first to leverage Docker cache
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend code
COPY . .

# Expose the port the app runs on
EXPOSE 8000

# Command to run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
