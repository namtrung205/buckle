#!/bin/bash
# ============================================================
#   Buckle Project - Setup Script (macOS/Linux)
#   Auto-install tools and dependencies for new machine
# ============================================================

set -e

# Ensure we always run from the directory containing this script,
# regardless of how/where it was launched (e.g. via "sudo ./setup.sh"
# or "bash /path/to/setup.sh" from a different working directory).
cd "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# ============================================================
#  CONFIGURATION
# ============================================================
REPO_URL="https://github.com/namtrung205/buckle.git"
PROJECT_DIR="buckle"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Detect package manager
detect_pkg_manager() {
    if command -v brew >/dev/null 2>&1; then
        echo "brew"
    elif command -v apt-get >/dev/null 2>&1; then
        echo "apt"
    elif command -v dnf >/dev/null 2>&1; then
        echo "dnf"
    elif command -v pacman >/dev/null 2>&1; then
        echo "pacman"
    else
        echo "unknown"
    fi
}

PKG_MANAGER=$(detect_pkg_manager)

install_with_pkg() {
    local pkg_name="$1"
    case "$PKG_MANAGER" in
        brew)
            brew install "$pkg_name"
            ;;
        apt)
            sudo apt-get update && sudo apt-get install -y "$pkg_name"
            ;;
        dnf)
            sudo dnf install -y "$pkg_name"
            ;;
        pacman)
            sudo pacman -S --noconfirm "$pkg_name"
            ;;
        *)
            error "Unsupported package manager. Please install $pkg_name manually."
            exit 1
            ;;
    esac
}

echo "============================================================"
echo "  Buckle Project - Setup Script (macOS/Linux)"
echo "  Auto-install tools and dependencies for new machine"
echo "============================================================"
echo ""
echo "Detected package manager: $PKG_MANAGER"
echo ""

# ============================================================
#  STEP 1: CHECK / INSTALL GIT
# ============================================================
echo "[1/6] Checking Git..."
if command -v git >/dev/null 2>&1; then
    ok "Git $(git --version | awk '{print $3}')"
else
    warn "Git not found. Installing..."
    install_with_pkg "git"
    ok "Git installed."
fi
echo ""

# ============================================================
#  STEP 2: CHECK / INSTALL NODE.JS + NPM
# ============================================================
echo "[2/6] Checking Node.js..."
if command -v node >/dev/null 2>&1; then
    ok "Node $(node --version)"
    ok "npm $(npm --version)"
else
    warn "Node.js not found. Installing..."
    case "$PKG_MANAGER" in
        brew)
            brew install node@18
            ;;
        apt)
            curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        dnf)
            sudo dnf install -y nodejs
            ;;
        pacman)
            sudo pacman -S --noconfirm nodejs npm
            ;;
        *)
            error "Unsupported package manager. Please install Node.js manually from https://nodejs.org/"
            exit 1
            ;;
    esac
    ok "Node.js installed."
    info "Please close and reopen this terminal, then re-run setup.sh"
    exit 0
fi
echo ""

# ============================================================
#  STEP 3: CHECK / INSTALL PYTHON
# ============================================================
echo "[3/6] Checking Python..."
if command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
    ok "Python $(python3 --version 2>&1)"
else
    warn "Python not found. Installing..."
    case "$PKG_MANAGER" in
        brew)
            brew install python@3.12
            ;;
        apt)
            sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip
            ;;
        dnf)
            sudo dnf install -y python3 python3-pip
            ;;
        pacman)
            sudo pacman -S --noconfirm python python-pip
            ;;
        *)
            error "Unsupported package manager. Please install Python manually from https://www.python.org/downloads/"
            exit 1
            ;;
    esac
    PYTHON_CMD="python3"
    ok "Python installed."
    info "Please close and reopen this terminal, then re-run setup.sh"
    exit 0
fi
echo ""

# ============================================================
#  STEP 4: CHECK / INSTALL MONGODB (OPTIONAL)
# ============================================================
echo "[4/6] Checking MongoDB (optional)..."
if command -v mongod >/dev/null 2>&1; then
    ok "MongoDB found."
else
    warn "MongoDB not found. This is optional for user authentication."
    info "To install MongoDB:"
    info "  macOS:  brew tap mongodb/brew && brew install mongodb-community"
    info "  Ubuntu: See https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/"
    info "  Or use Docker: docker run -d -p 27017:27017 --name buckle-mongo mongo:latest"
fi
echo ""

# ============================================================
#  STEP 5: CHECK / INSTALL DOCKER (OPTIONAL)
# ============================================================
echo "[5/6] Checking Docker (optional)..."
if command -v docker >/dev/null 2>&1; then
    ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
else
    warn "Docker not found. This is optional for containerized deployment."
    info "To install Docker:"
    info "  macOS:  brew install --cask docker"
    info "  Linux:  curl -fsSL https://get.docker.com | sh"
fi
echo ""

# ============================================================
#  STEP 6: CLONE PROJECT + INSTALL DEPENDENCIES
# ============================================================
echo "[6/6] Setting up project..."

# Check if we are already inside the project (has frontend/ and backend/)
if [ -f "frontend/package.json" ] && [ -f "backend/requirements.txt" ]; then
    ok "Already inside the project directory."
    PROJECT_DIR="."
else
    # Clone project if not exists
    if [ ! -d "$PROJECT_DIR" ]; then
        info "Cloning repository..."
        git clone "$REPO_URL" "$PROJECT_DIR"
        if [ $? -ne 0 ]; then
            error "Failed to clone repository."
            exit 1
        fi
    else
        ok "Project directory already exists. Pulling latest changes..."
        (cd "$PROJECT_DIR" && git pull)
    fi
    cd "$PROJECT_DIR"
fi

# Create .env from example if not exists
if [ ! -f ".env" ]; then
    info "Creating .env from .env.example..."
    cp ".env.example" ".env"
    ok ".env created. Please edit it with your configuration."
else
    ok ".env already exists."
fi

# --- Frontend ---
echo ""
info "Installing frontend dependencies (npm install)..."
cd frontend
npm install
if [ $? -ne 0 ]; then
    error "Frontend dependencies installation failed."
    exit 1
fi
ok "Frontend dependencies installed."
cd ..

# --- Backend ---
echo ""
info "Setting up backend virtual environment..."
cd backend
if [ ! -d "env" ]; then
    $PYTHON_CMD -m venv env
    if [ $? -ne 0 ]; then
        error "Failed to create virtual environment."
        exit 1
    fi
fi
source env/bin/activate
info "Installing backend dependencies (pip install)..."
python -m pip install --upgrade pip
pip install -r requirements.txt
if [ $? -ne 0 ]; then
    error "Backend dependencies installation failed."
    exit 1
fi
ok "Backend dependencies installed."
cd ..

echo ""
echo "============================================================"
echo "  SETUP COMPLETE!"
echo "============================================================"
echo ""
echo "  Project: $PROJECT_DIR"
echo ""
echo "  To start the application:"
echo ""
echo "  Frontend:"
echo "    cd $PROJECT_DIR/frontend"
echo "    npm run dev"
echo "    Open http://localhost:5173"
echo ""
echo "  Backend:"
echo "    cd $PROJECT_DIR/backend"
echo "    source env/bin/activate"
echo "    python main.py"
echo "    Open http://localhost:8000/docs"
echo ""
echo "  Docker (optional, full stack):"
echo "    cd $PROJECT_DIR"
echo "    docker-compose up --build"
echo ""
echo "  Note: If MongoDB is not installed, user authentication features"
echo "  will not work. Install MongoDB or use Docker for full functionality."
echo ""