#!/bin/bash

# Buckle FEM Platform - Auto Deployment Script for Ubuntu
# --------------------------------------------------------

echo "🚀 Starting Buckle FEM Deployment..."

# 1. Check for Docker
if ! [ -x "$(command -v docker)" ]; then
  echo "📦 Installing Docker..."
  sudo apt-get update
  sudo apt-get install -y docker.io
  sudo systemctl enable --now docker
else
  echo "✅ Docker is already installed."
fi

# 2. Check for Docker Compose
if ! [ -x "$(command -v docker-compose)" ]; then
  echo "📦 Installing Docker Compose..."
  sudo apt-get install -y docker-compose
else
  echo "✅ Docker Compose is already installed."
fi

# 3. Handle Environment Variables
if [ ! -f .env ]; then
  echo "📝 Creating .env from .env.example..."
  cp .env.example .env
  
  echo "⚠️  Important: Please enter your Cloudflare Tunnel Token:"
  read -p "Token: " cf_token
  
  if [ ! -z "$cf_token" ]; then
    # Replace the placeholder in the new .env file
    # Using sed with a safe delimiter | since tokens might contain /
    sed -i "s|CLOUDFLARE_TUNNEL_TOKEN=.*|CLOUDFLARE_TUNNEL_TOKEN=$cf_token|g" .env
    echo "✅ Token updated in .env"
  else
    echo "⚠️  No token entered. Please update .env manually before running."
  fi
else
  echo "✅ Existing .env file found."
fi

# 4. Build and Launch Containers
echo "🏗️  Building and launching containers..."
sudo docker-compose up -d --build

# 5. Summary
echo "--------------------------------------------------------"
echo "✅ Deployment Process Finished!"
echo "📡 Check logs with: sudo docker-compose logs -f"
echo "🛠️  Check status with: sudo docker ps"
echo "--------------------------------------------------------"
