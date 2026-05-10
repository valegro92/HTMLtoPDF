# Deploy Status

**Run:** 25626461482  
**Commit:** a3a5eb3a682ff95b6e9c4b28c6cbb98f5da34a5e  
**Date:** 2026-05-10 10:33:53 UTC

## 1. FLY_API_TOKEN check
:white_check_mark: Token presente — lunghezza: 691 car., prefisso: `FlyV1 f`

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
82a47e8c-4de8-50fe-8363-7ffb6a911e16@tokens.fly.io
```
Exit code: 0

## 4. flyctl apps list
```
 NAME               │ OWNER    │ STATUS   │ LATEST DEPLOY 
 cassetta-htmltopdf │ personal │ deployed │ 16h42m ago    

```
Exit code: 0

## 5. flyctl deploy --remote-only
```
==> Verifying app config
Validating /home/runner/work/HTMLtoPDF/HTMLtoPDF/fly.toml
[32m✓[0m Configuration is valid
--> Verified app config
==> Building image
Waiting for depot builder...

==> Building image with Depot
--> build:  (​)
#1 [internal] load build definition from Dockerfile
#1 DONE 0.0s

#1 [internal] load build definition from Dockerfile
#1 transferring dockerfile: 857B 0.2s done
#1 DONE 0.2s

#2 [internal] load metadata for docker.io/library/node:20-slim
#2 DONE 0.3s

#3 [internal] load .dockerignore
#3 transferring context: 102B 0.2s
#3 transferring context: 102B 0.2s done
#3 DONE 0.2s

#4 [1/6] FROM docker.io/library/node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0
#4 resolve docker.io/library/node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 done
#4 DONE 0.0s

#5 [internal] load build context
#5 transferring context: 409.70kB 0.5s done
#5 DONE 0.5s

#6 [2/6] RUN apt-get update && apt-get install -y     chromium     fonts-liberation     fonts-noto-color-emoji     libatk-bridge2.0-0     libatk1.0-0     libcups2     libdbus-1-3     libdrm2     libgbm1     libnspr4     libnss3     libxcomposite1     libxdamage1     libxfixes3     libxkbcommon0     libxrandr2     --no-install-recommends     && rm -rf /var/lib/apt/lists/*
#6 CACHED

#7 [3/6] WORKDIR /app
#7 CACHED

#8 [4/6] COPY package*.json ./
#8 DONE 0.0s

#9 [5/6] RUN npm ci --omit=dev --ignore-scripts
#9 4.200 npm warn deprecated puppeteer@23.11.1: < 24.15.0 is no longer supported
#9 4.229 npm warn deprecated glob@10.5.0: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me
#9 4.944 
#9 4.944 added 267 packages, and audited 268 packages in 4s
#9 4.944 
#9 4.944 38 packages are looking for funding
#9 4.944   run `npm fund` for details
#9 4.948 
#9 4.948 3 vulnerabilities (1 moderate, 2 high)
#9 4.948 
#9 4.948 To address all issues, run:
#9 4.948   npm audit fix
#9 4.948 
#9 4.948 Run `npm audit` for details.
#9 4.949 npm notice
#9 4.949 npm notice New major version of npm available! 10.8.2 -> 11.14.1
#9 4.949 npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.14.1
#9 4.949 npm notice To update run: npm install -g npm@11.14.1
#9 4.949 npm notice
#9 DONE 5.6s

#10 [6/6] COPY . .
#10 DONE 0.1s

#11 exporting to image
#11 exporting layers
#11 exporting layers 1.3s done
#11 exporting manifest sha256:35a48f3bf8b2c1d04d1fc73d3d74eff4bb522e56d1a76655f3d6aa537c0d5b8f done
#11 exporting config sha256:a5942bd6ea45198a5c8ec04a83d48d42859e86a5df6a3a0d33ac11bcdc865a55 done
#11 pushing layers for registry.fly.io/cassetta-htmltopdf:deployment-01KR8Q6RBXZDE591X8QFFE1QYP@sha256:35a48f3bf8b2c1d04d1fc73d3d74eff4bb522e56d1a76655f3d6aa537c0d5b8f
#11 pushing layer sha256:e63713b46b5bb28f092683f837befa1b1ac7f8394684a0b78bb07d8aa529e9e7
#11 pushing layer sha256:ea2b60f3338f30537bdab1ed54994203d1ead1c8d5eccddf4c765a4de72de66f
#11 pushing layer sha256:cd2d757325baf0d2f571dd4287b7268a3c5219e675e49320eb685d80a13c3f4e
#11 pushing layer sha256:12d475d252997f09f9ee1777835a1058b7e890ea8cec030c729396ea27c4c8ff
#11 pushing layer sha256:a5942bd6ea45198a5c8ec04a83d48d42859e86a5df6a3a0d33ac11bcdc865a55
#11 pushing layer sha256:2243cf1626c9741a1362ce7734d84169f70322c8a5033dda53a58981ece73b57
#11 pushing layer sha256:56b929f516b8989b818f27cb6306a665ffcd35c8d45d1a2e6019f94217717fdd 0.2s done
#11 pushing layer sha256:d47a14c887c91f3aefd6c374f761bb1436d91255d593df68f7c78def9ea6cdda
#11 pushing layer sha256:cafbacc3deae17253644d092525dcad7ce789fc6260a5d953d273549e118b0c6
#11 pushing layer sha256:0f7717c638de4578913abaa50505d868fdad208d7943d6c0b09fdc352a78a855
#11 pushing layer sha256:cfe42610999d219e11903496ae408c99612b16b265e8ca98ea743eb40400cdef
#11 pushing layer sha256:2243cf1626c9741a1362ce7734d84169f70322c8a5033dda53a58981ece73b57 0.8s done
#11 pushing layer sha256:cafbacc3deae17253644d092525dcad7ce789fc6260a5d953d273549e118b0c6 0.8s done
#11 pushing layer sha256:ea2b60f3338f30537bdab1ed54994203d1ead1c8d5eccddf4c765a4de72de66f 0.8s done
#11 pushing layer sha256:cd2d757325baf0d2f571dd4287b7268a3c5219e675e49320eb685d80a13c3f4e 0.8s done
#11 pushing layer sha256:12d475d252997f09f9ee1777835a1058b7e890ea8cec030c729396ea27c4c8ff 0.8s done
#11 pushing layer sha256:cfe42610999d219e11903496ae408c99612b16b265e8ca98ea743eb40400cdef 0.8s done
#11 pushing layer sha256:e63713b46b5bb28f092683f837befa1b1ac7f8394684a0b78bb07d8aa529e9e7 1.0s done
#11 pushing layer sha256:a5942bd6ea45198a5c8ec04a83d48d42859e86a5df6a3a0d33ac11bcdc865a55 1.0s done
#11 pushing layer sha256:d47a14c887c91f3aefd6c374f761bb1436d91255d593df68f7c78def9ea6cdda 1.0s done
#11 pushing layers for registry.fly.io/cassetta-htmltopdf:deployment-01KR8Q6RBXZDE591X8QFFE1QYP@sha256:35a48f3bf8b2c1d04d1fc73d3d74eff4bb522e56d1a76655f3d6aa537c0d5b8f 1.2s done
#11 pushing layer sha256:0f7717c638de4578913abaa50505d868fdad208d7943d6c0b09fdc352a78a855 1.2s done
#11 pushing manifest for registry.fly.io/cassetta-htmltopdf:deployment-01KR8Q6RBXZDE591X8QFFE1QYP@sha256:35a48f3bf8b2c1d04d1fc73d3d74eff4bb522e56d1a76655f3d6aa537c0d5b8f
#11 pushing manifest for registry.fly.io/cassetta-htmltopdf:deployment-01KR8Q6RBXZDE591X8QFFE1QYP@sha256:35a48f3bf8b2c1d04d1fc73d3d74eff4bb522e56d1a76655f3d6aa537c0d5b8f 0.1s done
#11 DONE 2.6s
--> Build Summary:  (​)
[38;5;252m--> Building image done[0m
image: registry.fly.io/cassetta-htmltopdf:deployment-01KR8Q6RBXZDE591X8QFFE1QYP
image size: 317 MB

Watch your deployment at https://fly.io/apps/cassetta-htmltopdf/monitoring

[2mINFO[0m Using wait timeout: 10m0s lease timeout: 13s delay between lease refreshes: 4s

Updating existing machines in 'cassetta-htmltopdf' with rolling strategy
> [1/2] Acquiring lease for 18590deb29eee8
> [1/2] Acquired lease for 18590deb29eee8
> [2/2] Acquiring lease for 1854737c27e1d8
> [2/2] Acquired lease for 1854737c27e1d8
> [1/2] Updating machine config for 18590deb29eee8
> [2/2] Updating machine config for 1854737c27e1d8
> [2/2] Updating 1854737c27e1d8 [app]
> [1/2] Updating 18590deb29eee8 [app]
> [2/2] Updated machine config for 1854737c27e1d8
> [2/2] Waiting for machine 1854737c27e1d8 to reach a good state
> [1/2] Updated machine config for 18590deb29eee8
> [1/2] Waiting for machine 18590deb29eee8 to reach a good state
> [2/2] Machine 1854737c27e1d8 reached stopped state
✔ [2/2] Machine 1854737c27e1d8 is now in a good state
> [1/2] Machine 18590deb29eee8 reached started state
> [1/2] Running smoke checks on machine 18590deb29eee8
> [1/2] Running machine checks on machine 18590deb29eee8
> [1/2] Checking health of machine 18590deb29eee8
✔ [1/2] Machine 18590deb29eee8 is now in a good state
> [2/2] Clearing lease for 1854737c27e1d8
> [1/2] Clearing lease for 18590deb29eee8
✔ [2/2] Cleared lease for 1854737c27e1d8
✔ [1/2] Cleared lease for 18590deb29eee8
Checking DNS configuration for cassetta-htmltopdf.fly.dev
✓ DNS configuration verified

Visit your newly deployed app at https://cassetta-htmltopdf.fly.dev/

```
Exit code: 0

:rocket: **Deploy riuscito**
