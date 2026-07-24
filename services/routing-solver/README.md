# Transport VRPTW solver sidecar (optional)

A small FastAPI + Google OR-Tools service that solves the vehicle-routing problem
with time windows for the transport planner. **It is optional.** The app always
has a working plan from its built-in greedy allocator (`lib/transport/allocate.ts`)
and only *upgrades* to this solver when it is enabled, reachable and answers in
time. If it is down, slow, or off, the planner silently uses the greedy result —
so this service is never on the critical path.

## Status on this deployment

**Provided but NOT enabled.** vps7 runs another production app and has limited
spare RAM (~1.5–3 GB free), and OR-Tools' solver adds ~200–300 MB resident plus
CPU spikes during a solve. Enabling it needs a deliberate resource decision and a
live verification pass, so it ships disabled: `SOLVER_URL` is unset, so
`solveVrptw()` returns `null` and the greedy allocator runs exactly as before.

## Run locally / on a box with headroom

```bash
cd services/routing-solver
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8090
```

Managed under pm2:

```bash
pm2 start "uvicorn main:app --host 127.0.0.1 --port 8090" \
  --name transport-solver --cwd /var/www/education-center/services/routing-solver
```

## Enable in the app

Set in `.env` and restart the app:

```
SOLVER_ENABLED=1
SOLVER_URL=http://127.0.0.1:8090
SOLVER_REQUEST_TIMEOUT_MS=15000
```

Health check: `curl http://127.0.0.1:8090/health` → `{"ok":true}`.

## Contract

`POST /solve` — see `SolveRequest`/`SolveResult` in
[`lib/transport/solver.ts`](../../lib/transport/solver.ts). Durations are an
asymmetric matrix in **seconds**; a `null` cell is an unreachable leg and is
priced so no feasible route uses it (never treated as 0). Stops carry `[earliest,
latest]` minute windows and a seat `demand`; vehicles carry capacity, a
start/end node and a shift window. Unfittable stops come back in `dropped`,
mirroring the greedy allocator's `unassigned` — a stop is never silently lost.

## Remaining wiring (deferred with the enablement)

`buildDayPlan` still calls the greedy allocator directly. The final swap —
build the matrix + windows, call `solveVrptw`, map routes back to `Assignment[]`,
fall through to greedy on `null` — is intentionally left until the sidecar can be
run and verified live, so an unverified optimiser never enters the working
planner.
