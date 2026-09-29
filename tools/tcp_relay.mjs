// Loopback TCP relay for the Windows 7662 client (manual Windows x web script).
//
// The operator's serverlist.bin points at 127.0.0.1:8281. tmserver answers both
// the HTTP status probe (GET /serv00.htm, see tmserver/internal/world/edge.go)
// and the CPSock game stream on its game port, so a byte-for-byte relay to the
// operator's target is enough. No game rules, no payload inspection, no payload
// logging: only connection lifecycle and byte counts.
//
//   node tools/tcp_relay.mjs --target reseau.proxy.rlwy.net:56950 [--listen 127.0.0.1:8281]
import net from 'node:net';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    target: { type: 'string' },
    listen: { type: 'string', default: '127.0.0.1:8281' },
  },
});

function hostPort(s, name) {
  const m = /^(.+):(\d{1,5})$/.exec(s ?? '');
  if (!m || +m[2] < 1 || +m[2] > 65535) throw new Error(`--${name} must be host:port`);
  return { host: m[1], port: +m[2] };
}

const target = hostPort(args.target, 'target');
const listen = hostPort(args.listen, 'listen');
// Loopback only: this must not become an open relay on the LAN.
if (!['127.0.0.1', 'localhost', '::1'].includes(listen.host)) {
  throw new Error('--listen must be a loopback address');
}

let seq = 0;
const server = net.createServer(client => {
  const id = ++seq;
  const t0 = Date.now();
  let up = 0, down = 0, closed = false;
  const remote = net.connect(target);
  client.setNoDelay(true);
  remote.setNoDelay(true);
  client.on('data', b => { up += b.length; });
  remote.on('data', b => { down += b.length; });
  client.pipe(remote);
  remote.pipe(client);
  const done = why => {
    if (closed) return;
    closed = true;
    client.destroy();
    remote.destroy();
    console.log(`[${new Date().toISOString()}] #${id} closed (${why}) ${Date.now() - t0}ms up=${up} down=${down}`);
  };
  client.on('close', () => done('client'));
  remote.on('close', () => done('remote'));
  client.on('error', e => done(`client ${e.code ?? 'error'}`));
  remote.on('error', e => done(`remote ${e.code ?? 'error'}`));
  console.log(`[${new Date().toISOString()}] #${id} open`);
});

server.listen(listen.port, listen.host, () => {
  console.log(`relay ${listen.host}:${listen.port} -> ${target.host}:${target.port}`);
});
