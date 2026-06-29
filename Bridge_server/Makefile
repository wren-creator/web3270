.PHONY: up down restart logs build setup _migrate-macros

setup:
	@sh setup.sh

# Move any macros from the old macros/macros.json path to macros/local/
# before Docker starts. Runs as a no-op once migration is done.
_migrate-macros:
	@mkdir -p macros/local
	@if [ -f macros/macros.json ] && [ ! -f macros/local/macros.json ]; then \
		cp macros/macros.json macros/local/macros.json && \
		echo "Migrated macros/macros.json → macros/local/macros.json"; \
	fi

up: _migrate-macros
	@if [ ! -f .env ]; then \
		echo "No .env found — run './setup.sh' to configure ports, or copy .env.example to .env."; \
		echo "Starting with defaults (bridge on port 8081)..."; \
		echo ""; \
	fi
	docker compose up $(ARGS)

down:
	docker compose down

restart:
	docker compose restart tn3270-bridge

build:
	docker compose build

logs:
	docker compose logs -f tn3270-bridge
