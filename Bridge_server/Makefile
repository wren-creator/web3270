.PHONY: up down restart logs build

# Always seed macros/macros.json as a FILE before Docker starts.
# If the file doesn't exist, Docker creates a directory there instead,
# causing EISDIR when the server tries to write macros.
up:
	@[ -f macros/macros.json ] || echo '[]' > macros/macros.json
	docker compose up $(ARGS)

down:
	docker compose down

restart:
	@[ -f macros/macros.json ] || echo '[]' > macros/macros.json
	docker compose restart tn3270-bridge

build:
	@[ -f macros/macros.json ] || echo '[]' > macros/macros.json
	docker compose build

logs:
	docker compose logs -f tn3270-bridge
