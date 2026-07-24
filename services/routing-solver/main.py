"""
VRPTW solver sidecar for the transport planner (spec §15).

A small FastAPI service wrapping Google OR-Tools' routing solver. The Next.js
app calls POST /solve with a duration matrix, per-stop time windows and the
fleet; it returns per-vehicle stop orders with arrival times, plus any stops it
could not fit. It is OPTIONAL: the app falls back to its greedy allocator
whenever this service is disabled, unreachable, or slow, so nothing here is on
the critical path. Keep it bound to localhost behind the app.

Run (see README.md):
    pip install -r requirements.txt
    uvicorn main:app --host 127.0.0.1 --port 8090
"""
from typing import List, Optional

from fastapi import FastAPI
from pydantic import BaseModel
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

app = FastAPI(title="transport-vrptw-solver")

# A large finite stand-in for an unreachable leg. OR-Tools needs integer arc
# costs, so `null` (no road value) becomes a cost no feasible route would pay —
# never 0, which would invite the solver to "teleport" across a missing edge.
UNREACHABLE_S = 10 ** 8


class Stop(BaseModel):
    id: str
    node: int
    earliestMin: int
    latestMin: int
    demand: int


class Vehicle(BaseModel):
    id: str
    capacity: int
    startNode: int
    endNode: int
    shiftStartMin: int
    shiftEndMin: int


class SolveRequest(BaseModel):
    durationMatrix: List[List[Optional[int]]]
    stops: List[Stop]
    vehicles: List[Vehicle]
    solverTimeoutSeconds: int = 20


class Route(BaseModel):
    vehicleId: str
    stopIds: List[str]
    arrivalMin: List[int]


class SolveResult(BaseModel):
    routes: List[Route]
    dropped: List[str]
    provider: str = "ortools"


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/solve", response_model=SolveResult)
def solve(req: SolveRequest) -> SolveResult:
    n = len(req.durationMatrix)
    if n == 0 or not req.vehicles:
        return SolveResult(routes=[], dropped=[s.id for s in req.stops])

    # Seconds everywhere internally; time windows arrive in minutes.
    def arc_s(i: int, j: int) -> int:
        v = req.durationMatrix[i][j]
        return UNREACHABLE_S if v is None else int(v)

    starts = [v.startNode for v in req.vehicles]
    ends = [v.endNode for v in req.vehicles]
    manager = pywrapcp.RoutingIndexManager(n, len(req.vehicles), starts, ends)
    routing = pywrapcp.RoutingModel(manager)

    transit_cb = routing.RegisterTransitCallback(
        lambda a, b: arc_s(manager.IndexToNode(a), manager.IndexToNode(b))
    )
    routing.SetArcCostEvaluatorOfAllVehicles(transit_cb)

    # Time dimension (seconds). Horizon covers the widest shift.
    horizon = max(v.shiftEndMin for v in req.vehicles) * 60
    routing.AddDimension(transit_cb, horizon, horizon, False, "Time")
    time_dim = routing.GetDimensionOrDie("Time")

    stops_by_node = {s.node: s for s in req.stops}
    for node, stop in stops_by_node.items():
        idx = manager.NodeToIndex(node)
        if idx >= 0:
            time_dim.CumulVar(idx).SetRange(stop.earliestMin * 60, stop.latestMin * 60)

    for vi, veh in enumerate(req.vehicles):
        s = routing.Start(vi)
        e = routing.End(vi)
        time_dim.CumulVar(s).SetRange(veh.shiftStartMin * 60, veh.shiftEndMin * 60)
        time_dim.CumulVar(e).SetRange(veh.shiftStartMin * 60, veh.shiftEndMin * 60)

    # Capacity dimension.
    demand_cb = routing.RegisterUnaryTransitCallback(
        lambda a: stops_by_node.get(manager.IndexToNode(a), Stop(id="", node=-1, earliestMin=0, latestMin=0, demand=0)).demand
    )
    routing.AddDimensionWithVehicleCapacity(
        demand_cb, 0, [v.capacity for v in req.vehicles], True, "Capacity"
    )

    # A stop may be dropped at a high penalty — better an explicit unassigned
    # than an infeasible model (mirrors the greedy allocator's `unassigned`).
    penalty = UNREACHABLE_S
    for node, stop in stops_by_node.items():
        idx = manager.NodeToIndex(node)
        if idx >= 0:
            routing.AddDisjunction([idx], penalty)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.FromSeconds(max(1, int(req.solverTimeoutSeconds)))

    sol = routing.SolveWithParameters(params)
    if sol is None:
        return SolveResult(routes=[], dropped=[s.id for s in req.stops])

    routes: List[Route] = []
    served: set[str] = set()
    for vi, veh in enumerate(req.vehicles):
        idx = routing.Start(vi)
        stop_ids: List[str] = []
        arrivals: List[int] = []
        while not routing.IsEnd(idx):
            node = manager.IndexToNode(idx)
            stop = stops_by_node.get(node)
            if stop is not None:
                stop_ids.append(stop.id)
                arrivals.append(sol.Value(time_dim.CumulVar(idx)) // 60)
                served.add(stop.id)
            idx = sol.Value(routing.NextVar(idx))
        if stop_ids:
            routes.append(Route(vehicleId=veh.id, stopIds=stop_ids, arrivalMin=arrivals))

    dropped = [s.id for s in req.stops if s.id not in served]
    return SolveResult(routes=routes, dropped=dropped)
