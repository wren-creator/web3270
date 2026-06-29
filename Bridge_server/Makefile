.PHONY: up down restart logs build _migrate-macros

# Move any macros from the old macros/macros.json path to macros/local/
# before Docker starts. Runs as a no-op once migration is done.
_migrate-macros:
	@mkdir -p macros/local
	@if [ -f macros/macros.json ] && [ ! -f macros/local/macros.json ]; then \
		cp macros/macros.json macros/local/macros.json && \
		echo "Migrated macros/macros.json → macros/local/macros.json"; \
	fi

up: _migrate-macros
	docker compose up $(ARGS)

down:
	docker compose down

restart:
	docker compose restart tn3270-bridge

build:
	docker compose build

logs:
	docker compose logs -f tn3270-bridge
