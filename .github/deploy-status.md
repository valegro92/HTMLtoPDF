# Deploy Status

**Run:** 25651354951  
**Commit:** 4cbaf68dbe8cfa44ca95e14c29f1dcff50859a7e  
**Date:** 2026-05-11 05:03:47 UTC

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
 cassetta-htmltopdf │ personal │ deployed │ 14h17m ago    

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
#1 transferring dockerfile: 857B 0.1s done
#1 DONE 0.1s

#2 [internal] load metadata for docker.io/library/node:20-slim
#2 DONE 0.2s

#3 [internal] load .dockerignore
#3 transferring context: 102B 0.2s done
#3 DONE 0.2s

#4 [1/6] FROM docker.io/library/node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0
#4 resolve docker.io/library/node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 done
#4 DONE 0.0s

#5 [internal] load build context
#5 transferring context: 433.25kB 0.3s done
#5 DONE 0.3s

#6 [2/6] RUN apt-get update && apt-get install -y     chromium     fonts-liberation     fonts-noto-color-emoji     libatk-bridge2.0-0     libatk1.0-0     libcups2     libdbus-1-3     libdrm2     libgbm1     libnspr4     libnss3     libxcomposite1     libxdamage1     libxfixes3     libxkbcommon0     libxrandr2     --no-install-recommends     && rm -rf /var/lib/apt/lists/*
#6 CACHED

#7 [3/6] WORKDIR /app
#7 CACHED

#8 [4/6] COPY package*.json ./
#8 CACHED

#9 [5/6] RUN npm ci --omit=dev --ignore-scripts
#9 CACHED

#10 [6/6] COPY . .
#10 DONE 0.1s

#11 exporting to image
#11 exporting layers 0.0s done
#11 exporting manifest sha256:14bd1f68b22f0c311d833c47f45d6d04c285688d91129dec84f8b71ebd55ef9b done
#11 exporting config sha256:284d04ef506f8f48d31b6304f0bd718cc1a9f8ee124eda29f47a818b7b778032 done
#11 pushing layers for registry.fly.io/cassetta-htmltopdf:deployment-01KRAPQ1HHVZZHJZ1APG0ZHAQ8@sha256:14bd1f68b22f0c311d833c47f45d6d04c285688d91129dec84f8b71ebd55ef9b
#11 pushing layer sha256:61638f7010a22d32ab02c2f75908743e87dbd21ded32b1880ea68d98c6d42b8d
#11 pushing layer sha256:284d04ef506f8f48d31b6304f0bd718cc1a9f8ee124eda29f47a818b7b778032
#11 pushing layer sha256:cfe42610999d219e11903496ae408c99612b16b265e8ca98ea743eb40400cdef
#11 pushing layer sha256:cafbacc3deae17253644d092525dcad7ce789fc6260a5d953d273549e118b0c6
#11 pushing layer sha256:56b929f516b8989b818f27cb6306a665ffcd35c8d45d1a2e6019f94217717fdd
#11 pushing layer sha256:ea2b60f3338f30537bdab1ed54994203d1ead1c8d5eccddf4c765a4de72de66f
#11 pushing layer sha256:cd2d757325baf0d2f571dd4287b7268a3c5219e675e49320eb685d80a13c3f4e 0.1s done
#11 pushing layer sha256:2243cf1626c9741a1362ce7734d84169f70322c8a5033dda53a58981ece73b57
#11 pushing layer sha256:12d475d252997f09f9ee1777835a1058b7e890ea8cec030c729396ea27c4c8ff
#11 pushing layer sha256:d47a14c887c91f3aefd6c374f761bb1436d91255d593df68f7c78def9ea6cdda
#11 pushing layer sha256:0f7717c638de4578913abaa50505d868fdad208d7943d6c0b09fdc352a78a855
#11 pushing layer sha256:cfe42610999d219e11903496ae408c99612b16b265e8ca98ea743eb40400cdef 0.1s done
#11 pushing layer sha256:2243cf1626c9741a1362ce7734d84169f70322c8a5033dda53a58981ece73b57 0.2s done
#11 pushing layer sha256:0f7717c638de4578913abaa50505d868fdad208d7943d6c0b09fdc352a78a855 0.4s done
#11 pushing layer sha256:61638f7010a22d32ab02c2f75908743e87dbd21ded32b1880ea68d98c6d42b8d 0.5s done
#11 pushing layer sha256:cafbacc3deae17253644d092525dcad7ce789fc6260a5d953d273549e118b0c6 0.4s done
#11 pushing layer sha256:56b929f516b8989b818f27cb6306a665ffcd35c8d45d1a2e6019f94217717fdd 0.4s done
#11 pushing layer sha256:ea2b60f3338f30537bdab1ed54994203d1ead1c8d5eccddf4c765a4de72de66f 0.4s done
#11 pushing layer sha256:12d475d252997f09f9ee1777835a1058b7e890ea8cec030c729396ea27c4c8ff 0.4s done
#11 pushing layer sha256:d47a14c887c91f3aefd6c374f761bb1436d91255d593df68f7c78def9ea6cdda 0.4s done
#11 pushing layers for registry.fly.io/cassetta-htmltopdf:deployment-01KRAPQ1HHVZZHJZ1APG0ZHAQ8@sha256:14bd1f68b22f0c311d833c47f45d6d04c285688d91129dec84f8b71ebd55ef9b 0.5s done
#11 pushing layer sha256:284d04ef506f8f48d31b6304f0bd718cc1a9f8ee124eda29f47a818b7b778032 0.5s done
#11 pushing manifest for registry.fly.io/cassetta-htmltopdf:deployment-01KRAPQ1HHVZZHJZ1APG0ZHAQ8@sha256:14bd1f68b22f0c311d833c47f45d6d04c285688d91129dec84f8b71ebd55ef9b 0.1s done
#11 DONE 0.7s
--> Build Summary:  (​)
[38;5;252m--> Building image done[0m
image: registry.fly.io/cassetta-htmltopdf:deployment-01KRAPQ1HHVZZHJZ1APG0ZHAQ8
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
