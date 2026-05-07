.PHONY: help install-hooks dev build data test test-integration smoke lint fmt pages-preview clean hooks-pre-commit hooks-commit-msg hooks-pre-push release

help:
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "%-22s %s\n", $$1, $$2}'

install-hooks: ## wire local git hooks
	git config core.hooksPath .githooks
	chmod +x .githooks/*

dev: ## run frontend dev server
	npm run dev

build: ## build GitHub Pages output in docs/
	npm run build
	bash scripts/check-pages-output.sh

data: ## no-op for Mode A
	@echo "Mode A has no static data pipeline."

test: ## run unit tests
	npm run test

test-integration: ## no-op integration placeholder for Mode A
	@echo "No integration tests are required for Mode A v0.1.0."

smoke: ## build and run Playwright smoke
	npm run smoke

lint: ## run linters and typecheck
	npm run lint
	npm run typecheck
	npm run fmt:check
	npm run audit

fmt: ## autoformat
	npm run fmt

pages-preview: ## serve docs/ like GitHub Pages
	npm run pages:preview

hooks-pre-commit: ## run pre-commit hook manually
	.githooks/pre-commit

hooks-commit-msg: ## run commit-msg hook manually with MSG_FILE=...
	.githooks/commit-msg $${MSG_FILE:-.git/COMMIT_EDITMSG}

hooks-pre-push: ## run pre-push hook manually
	.githooks/pre-push

release: ## tag current commit as v$(VERSION)
	test -n "$(VERSION)"
	git tag -a "v$(VERSION)" -m "v$(VERSION)"
	git push origin "v$(VERSION)"

clean: ## remove local build artifacts
	rm -rf dist coverage playwright-report test-results .vite
