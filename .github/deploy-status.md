# Deploy Status

**Run:** 25601589999  
**Commit:** 2b2726e7d03711071f10e58fe57d9d9241d8cd85  
**Date:** 2026-05-09 12:51:50 UTC

## 1. FLY_API_TOKEN check
:x: **FLY_API_TOKEN è VUOTO** — il secret non è impostato

## 2. fly.toml
```toml
app = 'cassetta-htmltopdf'
primary_region = 'fra'

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = 'stop'
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  memory = '1gb'
  cpu_kind = 'shared'
  cpus = 1
```

## 3. flyctl auth whoami
```
Error: no access token available. Please login with 'flyctl auth login'
```
Exit code: 1

## 4. flyctl apps list
```
Error: no access token available. Please login with 'flyctl auth login'
```
Exit code: 1

## 5. flyctl deploy --remote-only
```
Error: no access token available. Please login with 'flyctl auth login'
```
Exit code: 1

:x: **Deploy fallito** (exit code 1)
