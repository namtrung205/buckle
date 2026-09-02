.PHONY: dev dev-backend dev-web wasm build build-backend build-web \
       test test-engine test-backend test-web test-inventory \
       docker-build docker-up docker-down \
       clean fmt check

# ── Development ──────────────────────────────────────────────

## Start everything: backend + web dev server (requires .env in backend/)
dev:
	@echo "Starting backend and web dev server..."
	$(MAKE) -j2 dev-backend dev-web

dev-backend:
	cd backend && cargo run

dev-web: wasm
	cd web && npm install && npm run dev

## Build WASM engine for the frontend
wasm:
	cd engine && wasm-pack build --target web --out-dir ../web/src/lib/wasm --no-opt

# ── Build ────────────────────────────────────────────────────

build: build-backend build-web

build-backend:
	cargo build -p dedaliano-backend --release

build-web: wasm
	cd web && npm install && npm run build

# ── Test ─────────────────────────────────────────────────────

test: test-engine test-backend test-web

test-engine:
	cargo test -p dedaliano-engine

test-backend:
	cargo test -p dedaliano-backend

test-web:
	cd web && npm install && npm test

## Measure the engine test inventory published in docs/BENCHMARKS.md.
## Engine-coupled = every target except `reference`, whose tests recompute
## textbook/code formulas inline and never call the engine (see
## engine/tests/reference/main.rs). Single pass: attributes each `test result`
## line to the target announced by the preceding `Running` line.
test-inventory:
	@cd engine && cargo test 2>&1 | awk -v sha="$$(git rev-parse --short HEAD)" -v day="$$(date +%Y-%m-%d)" ' \
		/^[[:space:]]*Running / { target = $$2 } \
		/^[[:space:]]*Doc-tests / { target = "doc-tests" } \
		/^test result:/ { \
			if ($$5 != "passed;") next; \
			if (target ~ /reference/) ref += $$4; else eng += $$4; \
			failed += $$6; seen++; \
		} \
		END { \
			if (seen < 20 || ref == 0) { \
				printf "INCOMPLETE RUN (%d target(s) reported, reference=%d) — do not publish these numbers.\n", seen, ref; \
				exit 1; \
			} \
			printf "measured at %s on %s\n", sha, day; \
			printf "engine-coupled: %d passing, %d failures\n", eng, failed; \
			printf "reference-formula self-checks: %d passing\n", ref; \
			printf "total registered: %d\n", eng + ref; \
		}'

# ── Docker ───────────────────────────────────────────────────

docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

# ── Utilities ────────────────────────────────────────────────

fmt:
	cargo fmt --all

check:
	cargo clippy --workspace -- -D warnings

clean:
	cargo clean
	rm -rf web/dist web/node_modules/.vite
