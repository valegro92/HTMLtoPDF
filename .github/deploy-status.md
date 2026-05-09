# Deploy Status

**Run:** 25607092417  
**Commit:** 5055c6cdc493f8f2c174bee9b72ae179ca1abff6  
**Date:** 2026-05-09 17:20:25 UTC

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
 cassetta-htmltopdf │ personal │ deployed │ 5m54s ago     

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
#1 transferring dockerfile: 857B 0.0s done
#1 DONE 0.0s

#2 [internal] load metadata for docker.io/library/node:20-slim
#2 DONE 0.2s

#3 [internal] load .dockerignore
#3 transferring context: 102B 0.0s done
#3 DONE 0.0s

#4 [1/6] FROM docker.io/library/node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0
#4 resolve docker.io/library/node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 done
#4 DONE 0.0s

#5 [internal] load build context
#5 transferring context: 319.22kB 0.1s done
#5 DONE 0.1s

#6 [3/6] WORKDIR /app
#6 CACHED

#7 [4/6] COPY package*.json ./
#7 CACHED

#8 [2/6] RUN apt-get update && apt-get install -y     chromium     fonts-liberation     fonts-noto-color-emoji     libatk-bridge2.0-0     libatk1.0-0     libcups2     libdbus-1-3     libdrm2     libgbm1     libnspr4     libnss3     libxcomposite1     libxdamage1     libxfixes3     libxkbcommon0     libxrandr2     --no-install-recommends     && rm -rf /var/lib/apt/lists/*
#8 CACHED

#9 [5/6] RUN npm ci --omit=dev --ignore-scripts
#9 CACHED

#10 [6/6] COPY . .
#10 DONE 0.0s

#11 exporting to image
#11 exporting layers 0.1s done
#11 exporting manifest sha256:d62891102c631e6a437dff1d912ac59e631f336d5a21dfd129ba6f815b7d01d7 done
#11 exporting config sha256:015a469df8677b594f0845f8871c471cf5b8a8dc8fd8c149d94ad3a5a8681330 done
#11 pushing layers for registry.fly.io/cassetta-htmltopdf:deployment-01KR6W2DC76G4MMS4SX5EYCBE1@sha256:d62891102c631e6a437dff1d912ac59e631f336d5a21dfd129ba6f815b7d01d7
#11 pushing layer sha256:015a469df8677b594f0845f8871c471cf5b8a8dc8fd8c149d94ad3a5a8681330
#11 pushing layer sha256:23b800e518551cef70bbbaf68e2dee8889ad1821b90b21979acf2f748127b56f
#11 pushing layer sha256:2243cf1626c9741a1362ce7734d84169f70322c8a5033dda53a58981ece73b57 0.0s done
#11 pushing layer sha256:3fc0eae1aba748376103237e066b99c35684c70ecee25c7ce33a0d925cc482c5
#11 pushing layer sha256:cd2d757325baf0d2f571dd4287b7268a3c5219e675e49320eb685d80a13c3f4e
#11 pushing layer sha256:2fed3459f1345fcf577f3cee0671fc66f6326a38d788808fbda76c8ad770d0a3
#11 pushing layer sha256:ea2b60f3338f30537bdab1ed54994203d1ead1c8d5eccddf4c765a4de72de66f
#11 pushing layer sha256:cfe42610999d219e11903496ae408c99612b16b265e8ca98ea743eb40400cdef
#11 pushing layer sha256:56b929f516b8989b818f27cb6306a665ffcd35c8d45d1a2e6019f94217717fdd
#11 pushing layer sha256:12d475d252997f09f9ee1777835a1058b7e890ea8cec030c729396ea27c4c8ff
#11 pushing layer sha256:cafbacc3deae17253644d092525dcad7ce789fc6260a5d953d273549e118b0c6
#11 pushing layer sha256:23b800e518551cef70bbbaf68e2dee8889ad1821b90b21979acf2f748127b56f 0.2s done
#11 pushing layer sha256:3fc0eae1aba748376103237e066b99c35684c70ecee25c7ce33a0d925cc482c5 0.1s done
#11 pushing layer sha256:cd2d757325baf0d2f571dd4287b7268a3c5219e675e49320eb685d80a13c3f4e 0.1s done
#11 pushing layer sha256:2fed3459f1345fcf577f3cee0671fc66f6326a38d788808fbda76c8ad770d0a3 0.0s done
#11 pushing layer sha256:ea2b60f3338f30537bdab1ed54994203d1ead1c8d5eccddf4c765a4de72de66f 0.1s done
#11 pushing layer sha256:cfe42610999d219e11903496ae408c99612b16b265e8ca98ea743eb40400cdef 0.1s done
#11 pushing layer sha256:56b929f516b8989b818f27cb6306a665ffcd35c8d45d1a2e6019f94217717fdd 0.1s done
#11 pushing layer sha256:12d475d252997f09f9ee1777835a1058b7e890ea8cec030c729396ea27c4c8ff 0.1s done
#11 pushing layer sha256:cafbacc3deae17253644d092525dcad7ce789fc6260a5d953d273549e118b0c6 0.1s done
#11 pushing layers for registry.fly.io/cassetta-htmltopdf:deployment-01KR6W2DC76G4MMS4SX5EYCBE1@sha256:d62891102c631e6a437dff1d912ac59e631f336d5a21dfd129ba6f815b7d01d7 0.2s done
#11 pushing layer sha256:015a469df8677b594f0845f8871c471cf5b8a8dc8fd8c149d94ad3a5a8681330 0.2s done
#11 pushing manifest for registry.fly.io/cassetta-htmltopdf:deployment-01KR6W2DC76G4MMS4SX5EYCBE1@sha256:d62891102c631e6a437dff1d912ac59e631f336d5a21dfd129ba6f815b7d01d7 0.1s done
#11 DONE 0.4s
--> Build Summary:  (​)
[38;5;252m--> Building image done[0m
image: registry.fly.io/cassetta-htmltopdf:deployment-01KR6W2DC76G4MMS4SX5EYCBE1
image size: 317 MB

Watch your deployment at https://fly.io/apps/cassetta-htmltopdf/monitoring

[2mINFO[0m Using wait timeout: 10m0s lease timeout: 13s delay between lease refreshes: 4s

Updating existing machines in 'cassetta-htmltopdf' with rolling strategy
> [1/2] Acquiring lease for 1854737c27e1d8
> [1/2] Acquired lease for 1854737c27e1d8
> [2/2] Acquiring lease for 18590deb29eee8
> [2/2] Acquired lease for 18590deb29eee8
> [2/2] Updating machine config for 18590deb29eee8
> [1/2] Updating machine config for 1854737c27e1d8
> [1/2] Updating 1854737c27e1d8 [app]
> [2/2] Updating 18590deb29eee8 [app]
> [1/2] Updated machine config for 1854737c27e1d8
> [1/2] Waiting for machine 1854737c27e1d8 to reach a good state
> [2/2] Updated machine config for 18590deb29eee8
> [2/2] Waiting for machine 18590deb29eee8 to reach a good state
> [1/2] Machine 1854737c27e1d8 reached stopped state
✔ [1/2] Machine 1854737c27e1d8 is now in a good state
> [2/2] Machine 18590deb29eee8 reached started state
> [2/2] Running smoke checks on machine 18590deb29eee8
> [2/2] Running machine checks on machine 18590deb29eee8
> [2/2] Checking health of machine 18590deb29eee8
✔ [2/2] Machine 18590deb29eee8 is now in a good state
> [2/2] Clearing lease for 18590deb29eee8
> [1/2] Clearing lease for 1854737c27e1d8
✔ [1/2] Cleared lease for 1854737c27e1d8
✔ [2/2] Cleared lease for 18590deb29eee8
Checking DNS configuration for cassetta-htmltopdf.fly.dev
✓ DNS configuration verified

Visit your newly deployed app at https://cassetta-htmltopdf.fly.dev/

```
Exit code: 0

:rocket: **Deploy riuscito**
