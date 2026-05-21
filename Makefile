.PHONY: help install dev backend frontend stop test test-py test-web e2e clean

BACKEND_PORT ?= 8000
FRONTEND_PORT ?= 3000

help:
	@echo "Targets:"
	@echo "  make install     install backend + frontend deps"
	@echo "  make dev         start backend and frontend (Ctrl+C stops both)"
	@echo "  make backend     start backend only (port $(BACKEND_PORT))"
	@echo "  make frontend    start frontend only (port $(FRONTEND_PORT))"
	@echo "  make stop        kill anything bound to ports $(BACKEND_PORT) / $(FRONTEND_PORT)"
	@echo "  make test        run all tests (Python + frontend unit)"
	@echo "  make e2e         run Playwright e2e tests"
	@echo "  make clean       remove caches and build artifacts"

install:
	uv sync
	cd web && npm install

backend:
	uv run uvicorn server.main:app --reload --port $(BACKEND_PORT)

frontend:
	cd web && npm run dev

dev:
	@echo "Starting backend on :$(BACKEND_PORT) and frontend on :$(FRONTEND_PORT) — Ctrl+C to stop both"
	@trap 'kill 0' INT TERM EXIT; \
		uv run uvicorn server.main:app --reload --port $(BACKEND_PORT) & \
		(cd web && npm run dev) & \
		wait

stop:
	@lsof -ti:$(BACKEND_PORT),$(FRONTEND_PORT) 2>/dev/null | xargs -r kill -9 || true
	@echo "Stopped processes on ports $(BACKEND_PORT) and $(FRONTEND_PORT)"

test: test-py test-web

test-py:
	uv run pytest

test-web:
	cd web && npm test

e2e:
	cd web && npm run e2e

clean:
	rm -rf web/.next web/playwright-report web/test-results
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
