#!/usr/bin/env python3
"""Walkable waypoints between two tiles from the server's own maps.

Reads HeightMap.dat (4096^2) and AttributeMap.dat (1024^2) from a git object
store at a locked revision, bakes them like the server does at boot
(tmserver/internal/route: att&2 -> height 127) and runs an 8-direction BFS where
a step is passable iff the neighbour height is within (cur-8, cur+8), signed.
Diagonals also need both orthogonal cells passable, so the path never cuts a
wall corner. Prints the corners and waypoints spaced for verify_world walkTo.

The client routes on its own copy of the terrain; this is a planning aid for
the harness, not a claim about the client's route.
"""
import argparse
from collections import deque
import json
import subprocess

HM, AM, MH, BLOCKED = 4096, 1024, 8, 127
BOX = 160  # search window around start/end, in tiles


def blob(git_dir, rev, path, size):
    data = subprocess.run(['git', '-C', git_dir, 'show', f'{rev}:{path}'], capture_output=True, check=True).stdout
    if len(data) != size:
        raise SystemExit(f'{path}: {len(data)} bytes, expected {size}')
    return data


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--git-dir', default='external/server')
    ap.add_argument('--rev', default='98286fdf01202f503523e89d3e50b2183f00c36c')
    ap.add_argument('--from', dest='src', required=True, help='x,y')
    ap.add_argument('--to', dest='dst', required=True, help='x,y (a blocked NPC tile is fine: stops next to it)')
    ap.add_argument('--spacing', type=int, default=8, help='max tiles between waypoints')
    args = ap.parse_args()
    sx, sy = map(int, args.src.split(','))
    tx, ty = map(int, args.dst.split(','))
    h = blob(args.git_dir, args.rev, 'Release/TMsrv/run/HeightMap.dat', HM * HM)
    a = blob(args.git_dir, args.rev, 'Release/TMsrv/run/AttributeMap.dat', AM * AM)

    def height(x, y):
        if a[((y >> 2) & 0x3FF) * AM + ((x >> 2) & 0x3FF)] & 2:
            return BLOCKED
        v = h[y * HM + x]
        return v - 256 if v > 127 else v

    x0, x1 = min(sx, tx) - BOX, max(sx, tx) + BOX
    y0, y1 = min(sy, ty) - BOX, max(sy, ty) + BOX

    def step(x, y, dx, dy):
        cur = height(x, y)
        ok = lambda nx, ny: x0 <= nx <= x1 and y0 <= ny <= y1 and cur - MH < height(nx, ny) < cur + MH
        if not ok(x + dx, y + dy):
            return False
        return dx == 0 or dy == 0 or (ok(x + dx, y) and ok(x, y + dy))

    prev = {(sx, sy): None}
    q = deque([(sx, sy)])
    goal = None
    while q:
        x, y = q.popleft()
        if max(abs(x - tx), abs(y - ty)) <= 1:
            goal = (x, y)
            break
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if (dx or dy) and (x + dx, y + dy) not in prev and step(x, y, dx, dy):
                    prev[(x + dx, y + dy)] = (x, y)
                    q.append((x + dx, y + dy))
    if goal is None:
        raise SystemExit(f'no walkable path {sx},{sy} -> {tx},{ty} within {BOX} tiles')
    path = []
    node = goal
    while node:
        path.append(node)
        node = prev[node]
    path.reverse()
    corners = [path[0]] + [p for i, p in enumerate(path[1:-1], 1)
                           if (p[0] - path[i - 1][0], p[1] - path[i - 1][1]) != (path[i + 1][0] - p[0], path[i + 1][1] - p[1])] + [path[-1]]
    # Waypoints: corners, split so no leg exceeds --spacing tiles (on screen).
    way = []
    for c in corners[1:]:
        last = way[-1] if way else corners[0]
        i0 = path.index(last) if last in path else 0
        i1 = path.index(c)
        for i in range(i0 + args.spacing, i1, args.spacing):
            way.append(path[i])
        way.append(c)
    print(json.dumps({'rev': args.rev, 'from': [sx, sy], 'to': [tx, ty], 'steps': len(path) - 1,
                      'corners': corners, 'waypoints': [[x + 0.5, y + 0.5] for x, y in way]}))


if __name__ == '__main__':
    main()
